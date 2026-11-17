import { UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { AuthService } from "./auth.service";
import {
  REFRESH_COOKIE_NAME,
  buildRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from "./refresh-cookie";

// HP5 (plan G5): refresh rotation, reuse-detection and logout, exercised
// against an in-memory row store so the replacedByHash chain walks exactly
// like the DB does. Cookie attribute pinning lives here too — a flag
// regression would silently drop sessions in production.

const PASSWORD = "password123";
const DAY_SECONDS = 60 * 60 * 24;

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
  createdAt: Date;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function makeHarness() {
  const rows = new Map<string, Row>();
  let idCounter = 0;

  const prisma = {
    refreshToken: {
      findUnique: jest.fn(
        async ({ where }: { where: { tokenHash?: string } }) => {
          if (!where.tokenHash) return null;
          const row = rows.get(where.tokenHash);
          return row ? { ...row } : null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
        idCounter += 1;
        const row: Row = {
          id: `rt-${idCounter}`,
          userId: "user-1",
          revokedAt: null,
          replacedByHash: null,
          createdAt: new Date(),
          tokenHash: "",
          expiresAt: new Date(),
          ...data,
        } as Row;
        rows.set(row.tokenHash, row);
        return { ...row };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Row>;
        }) => {
          const row = [...rows.values()].find((r) => r.id === where.id);
          if (!row) throw new Error("refresh row not found");
          Object.assign(row, data);
          return { ...row };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; tokenHash?: string; revokedAt?: null };
          data: Partial<Row>;
        }) => {
          let count = 0;
          for (const row of rows.values()) {
            if (where.id !== undefined && row.id !== where.id) continue;
            if (
              where.tokenHash !== undefined &&
              row.tokenHash !== where.tokenHash
            ) {
              continue;
            }
            if ("revokedAt" in where && row.revokedAt !== null) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
    },
    user: {
      findUnique: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };

  const jwt = {
    signAsync: jest.fn().mockResolvedValue("fresh-access-token"),
  };
  const mail = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  prisma.user.findUnique.mockResolvedValue({
    id: "user-1",
    email: "buyer@bonagri.co.za",
    firstName: "Ben",
    lastName: "Buyer",
    phone: null,
    role: "BUYER",
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    twoFactorEnabled: false,
  });

  const service = new AuthService(
    prisma as never,
    jwt as never,
    mail as never,
  );

  // Seed a live row and hand back the RAW token whose hash keys it —
  // exactly what the browser would hold in its cookie.
  function seed(overrides: Partial<Row> = {}, rawToken?: string) {
    idCounter += 1;
    const raw = rawToken ?? `raw-${idCounter}`;
    const row: Row = {
      id: `rt-${idCounter}`,
      userId: "user-1",
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + 30 * DAY_SECONDS * 1000),
      revokedAt: null,
      replacedByHash: null,
      createdAt: new Date(),
      ...overrides,
    };
    rows.set(row.tokenHash, row);
    return { raw, row };
  }

  function rowByHash(tokenHash: string) {
    return rows.get(tokenHash);
  }

  return { service, prisma, jwt, rows, seed, rowByHash };
}

describe("AuthService.refreshSession (HP5 rotation)", () => {
  it("rotates: old row revoked + chained, new cookie + access token out", async () => {
    const { service, seed, rowByHash } = makeHarness();
    const { raw, row } = seed();

    const result = await service.refreshSession(raw);

    expect(result.accessToken).toBe("fresh-access-token");
    expect(result.user).toMatchObject({ id: "user-1" });

    // old row: revoked and chained to the successor's hash
    expect(row.revokedAt).toBeInstanceOf(Date);
    const cookie = result.refreshCookie;
    expect(typeof cookie).toBe("string");
    const nextRaw = readRefreshCookie(`a=b; ${cookie}`);
    expect(nextRaw).toBeTruthy();
    expect(nextRaw).not.toBe(raw);
    expect(row.replacedByHash).toBe(sha256(nextRaw!));

    // successor row: live, full TTL for a remembered session
    const nextRow = rowByHash(sha256(nextRaw!));
    expect(nextRow).toMatchObject({ revokedAt: null, userId: "user-1" });
    const remainingDays =
      nextRow!.expiresAt.getTime() - nextRow!.createdAt.getTime();
    expect(remainingDays).toBeGreaterThan(29 * DAY_SECONDS * 1000);
  });

  it("keeps an unremembered session a browser-session cookie (no Max-Age)", async () => {
    const { service, seed } = makeHarness();
    const twelveHours = 12 * 60 * 60;
    const { raw } = seed({
      expiresAt: new Date(Date.now() + twelveHours * 1000),
      createdAt: new Date(Date.now()),
    });

    const result = await service.refreshSession(raw);

    expect(result.refreshCookie).toContain(`${REFRESH_COOKIE_NAME}=`);
    expect(result.refreshCookie).not.toContain("Max-Age=");
  });

  it("replaying a rotated token revokes the WHOLE family (theft detection)", async () => {
    const { service, seed, rowByHash } = makeHarness();
    const first = seed();

    // raw1 → raw2 → raw3 (a live chain, as after two rotations)
    const second = await service.refreshSession(first.raw);
    const secondRaw = readRefreshCookie(second.refreshCookie!)!;
    const third = await service.refreshSession(secondRaw);
    const thirdRaw = readRefreshCookie(third.refreshCookie!)!;
    expect(rowByHash(sha256(thirdRaw))!.revokedAt).toBeNull();

    // attacker replays the long-dead raw1 → 401 + the victim's CURRENT
    // leaf (raw3) dies with it
    await expect(service.refreshSession(first.raw)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(rowByHash(sha256(thirdRaw))!.revokedAt).toBeInstanceOf(Date);
    expect(rowByHash(sha256(secondRaw))!.revokedAt).toBeInstanceOf(Date);
  });

  it("rejects an expired row and marks it revoked", async () => {
    const { service, seed, rowByHash } = makeHarness();
    const { raw, row } = seed({
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expect(service.refreshSession(raw)).rejects.toThrow(
      "Refresh token expired",
    );
    expect(rowByHash(row.tokenHash)!.revokedAt).toBeInstanceOf(Date);
  });

  it("rejects missing and unknown cookies with generic 401s", async () => {
    const { service } = makeHarness();

    await expect(service.refreshSession(undefined)).rejects.toThrow(
      "Missing refresh token",
    );
    await expect(service.refreshSession("not-a-real-token")).rejects.toThrow(
      "Invalid refresh token",
    );
  });

  it("refuses a suspended or unverified account and kills the row", async () => {
    const { service, prisma, seed, rowByHash } = makeHarness();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@bonagri.co.za",
      firstName: "Ben",
      lastName: "Buyer",
      phone: null,
      role: "BUYER",
      status: "SUSPENDED",
      emailVerifiedAt: new Date(),
    });
    const { raw, row } = seed();

    await expect(service.refreshSession(raw)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(rowByHash(row.tokenHash)!.revokedAt).toBeInstanceOf(Date);
  });
});

describe("AuthService.logoutSession (HP5)", () => {
  it("revokes the presented row and stays idempotent", async () => {
    const { service, seed, rowByHash } = makeHarness();
    const { raw, row } = seed();

    await expect(service.logoutSession(raw)).resolves.toEqual({ ok: true });
    expect(rowByHash(row.tokenHash)!.revokedAt).toBeInstanceOf(Date);

    // replaying logout with the same cookie must not throw
    await expect(service.logoutSession(raw)).resolves.toEqual({ ok: true });

    // no cookie at all is also fine (clears the caller's cookie anyway)
    await expect(service.logoutSession(undefined)).resolves.toEqual({
      ok: true,
    });
  });
});

describe("AuthService.login (HP5 refresh cookie)", () => {
  async function login(rememberMe?: boolean) {
    const { service } = makeHarness();
    return service.login({
      email: "buyer@bonagri.co.za",
      password: PASSWORD,
      rememberMe,
    });
  }

  it("mints a remembered refresh cookie alongside the access token", async () => {
    const result = await login(true);

    expect(result.accessToken).toBe("fresh-access-token");
    expect(result.refreshCookie).toContain("Max-Age=");
    expect(Number(result.refreshCookie.match(/Max-Age=(\d+)/)?.[1])).toBe(
      30 * DAY_SECONDS,
    );
    // the raw cookie value must be opaque — never derivable from the DB
    expect(result.refreshCookie).not.toContain(result.accessToken);
  });

  it("defaults to a browser-session cookie without rememberMe", async () => {
    const result = await login();

    expect(result.refreshCookie).toBeTruthy();
    expect(result.refreshCookie).not.toContain("Max-Age=");
  });
});

describe("refresh-cookie helpers (HP5 attributes)", () => {
  it("pins HttpOnly/SameSite=Lax/Secure/Path=/api/auth", () => {
    expect(buildRefreshCookie("abc")).toBe(
      "refresh_token=abc; HttpOnly; SameSite=Lax; Secure; Path=/api/auth",
    );
    expect(buildRefreshCookie("abc", 3600)).toBe(
      "refresh_token=abc; HttpOnly; SameSite=Lax; Secure; Path=/api/auth; Max-Age=3600",
    );
    expect(clearRefreshCookie()).toBe(
      "refresh_token=; HttpOnly; SameSite=Lax; Secure; Path=/api/auth; Max-Age=0",
    );
  });

  it("reads the cookie out of a multi-cookie header", () => {
    expect(readRefreshCookie("a=1; refresh_token=raw-x; b=2")).toBe("raw-x");
    expect(readRefreshCookie("refresh_token=")).toBeUndefined();
    expect(readRefreshCookie(undefined)).toBeUndefined();
    expect(readRefreshCookie("a=1")).toBeUndefined();
  });
});
