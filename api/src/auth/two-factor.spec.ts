import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { generateTotp, verifyTotp } from "./totp";

// HP2: the admin 2FA contract, exercised through the real controller, real
// AuthService and a real JWT — only Prisma and mail are in-memory mocks.
// RFC 6238 correctness itself is pinned in totp.spec.ts.

const TEST_SECRET = "test-secret";
const PASSWORD = "password123";

type TestUser = Record<string, unknown>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// A code guaranteed to fall outside ±1 step for the next couple of windows
// (wrong-code tests must never flake into the drift allowance).
function definitelyWrongCode(secret: string) {
  const now = Date.now();
  const dead = new Set(
    [-2, -1, 0, 1, 2].flatMap((k) =>
      Array.from(
        { length: 61 },
        (_, i) => generateTotp(secret, now + k * 30_000 + i * 1000),
      ),
    ),
  );
  for (let i = 0; i < 1000; i += 1) {
    const candidate = String(i).padStart(6, "0");
    if (!dead.has(candidate)) return candidate;
  }
  throw new Error("no wrong code found");
}

describe("HP2 admin 2FA (mandatory TOTP)", () => {
  let app: INestApplication;
  let users: Record<string, TestUser>;
  let prismaMock: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mailMock: { sendAdminLoginAlert: jest.Mock };

  const adminId = "admin-1";
  const buyerId = "buyer-1";

  async function loginAdmin() {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "admin@bonagri.co.za", password: PASSWORD })
      .expect(201);
    return response.body as {
      twoFactorRequired?: boolean;
      twoFactorSetupRequired?: boolean;
      preAuthToken: string;
      accessToken?: string;
    };
  }

  // Walks exactly what the web wizard does: login → setup → enable(TOTP).
  async function enrolAdmin() {
    const login = await loginAdmin();
    const setup = await request(app.getHttpServer())
      .post("/auth/2fa/setup")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .expect(201);
    const { secret, otpauthUri } = setup.body as {
      secret: string;
      otpauthUri: string;
    };
    const enable = await request(app.getHttpServer())
      .post("/auth/2fa/enable")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .send({ code: generateTotp(secret) })
      .expect(201);
    return {
      secret,
      otpauthUri,
      recoveryCodes: (enable.body as { recoveryCodes: string[] }).recoveryCodes,
      accessToken: (enable.body as { accessToken: string }).accessToken,
    };
  }

  function adminVerify(preAuthToken: string, code: string) {
    return request(app.getHttpServer())
      .post("/auth/2fa/verify")
      .set("Authorization", `Bearer ${preAuthToken}`)
      .send({ code });
  }

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    users = {};

    users[adminId] = {
      id: adminId,
      email: "admin@bonagri.co.za",
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      firstName: "Ada",
      lastName: "Admin",
      phone: null,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: null,
      twoFactorEnabledAt: null,
      twoFactorPreAuthHash: null,
      twoFactorPreAuthExp: null,
    };
    users[buyerId] = {
      id: buyerId,
      email: "buyer@bonagri.co.za",
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      firstName: "Ben",
      lastName: "Buyer",
      phone: null,
      role: "BUYER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      twoFactorEnabled: false,
    };

    prismaMock = {
      user: {
        findUnique: jest.fn(
          async ({ where }: { where: { id?: string; email?: string } }) => {
            const found = where.id
              ? users[where.id]
              : Object.values(users).find((user) => user.email === where.email);
            return found ? { ...found } : null;
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const record = users[where.id];
            if (!record) throw new Error("user not found");
            Object.assign(record, data);
            return { ...record };
          },
        ),
      },
      // HP5: 2FA verify / enrolment-as-login mint a refresh session — the
      // rows are write-only here (rotation itself lives in auth.refresh.spec).
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: `rt-${Math.random().toString(36).slice(2)}`,
            ...data,
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mailMock = {
      sendAdminLoginAlert: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 120 }],
        }),
        // Real JWT so tokens round-trip exactly as in production; the
        // pre-auth secret derives from JWT_SECRET.
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: 86400 },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MailService, useValue: mailMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("never issues a JWT on an admin password login (setup required)", async () => {
    const body = await loginAdmin();

    expect(body.twoFactorSetupRequired).toBe(true);
    expect(body.preAuthToken).toBeTruthy();
    expect(body.accessToken).toBeUndefined();
    expect(users[adminId].twoFactorPreAuthHash).toBe(
      sha256(body.preAuthToken),
    );
  });

  it("issues a pre-auth token — never a JWT — for an enrolled admin", async () => {
    await enrolAdmin();

    const body = await loginAdmin();
    expect(body.twoFactorRequired).toBe(true);
    expect(body.preAuthToken).toBeTruthy();
    expect(body.accessToken).toBeUndefined();
  });

  it("rejects the pre-auth token on protected routes", async () => {
    const login = await loginAdmin();

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .expect(401);
  });

  it("walks mandatory enrolment end-to-end and completes the login", async () => {
    const login = await loginAdmin();

    const setup = await request(app.getHttpServer())
      .post("/auth/2fa/setup")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .expect(201);
    const { secret, otpauthUri, accountLabel } = setup.body as {
      secret: string;
      otpauthUri: string;
      accountLabel: string;
    };
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${secret}`);
    expect(accountLabel).toBe("admin@bonagri.co.za");
    // pending secret is stored, but 2FA is NOT on yet
    expect(users[adminId].twoFactorSecret).toBe(secret);
    expect(users[adminId].twoFactorEnabled).toBe(false);

    const enable = await request(app.getHttpServer())
      .post("/auth/2fa/enable")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .send({ code: generateTotp(secret) })
      .expect(201);
    const { recoveryCodes, accessToken } = enable.body as {
      recoveryCodes: string[];
      accessToken: string;
    };
    expect(recoveryCodes).toHaveLength(10);
    expect(accessToken).toBeTruthy();

    expect(users[adminId].twoFactorEnabled).toBe(true);
    expect(users[adminId].twoFactorPreAuthHash).toBeNull();
    // recovery codes are stored as hashes — plaintext never persists
    expect(String(users[adminId].twoFactorRecoveryCodes)).not.toContain(
      recoveryCodes[0],
    );

    // enrolment-completed login hands back a working session + sign-in alert
    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      id: adminId,
      role: "ADMIN",
      twoFactorEnabled: true,
    });
    expect(mailMock.sendAdminLoginAlert).toHaveBeenCalledWith(
      "admin@bonagri.co.za",
      "Ada",
      expect.any(String),
    );
  });

  it("completes enrolment only with a valid code", async () => {
    const login = await loginAdmin();
    const setup = await request(app.getHttpServer())
      .post("/auth/2fa/setup")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .expect(201);
    const { secret } = setup.body as { secret: string };

    await request(app.getHttpServer())
      .post("/auth/2fa/enable")
      .set("Authorization", `Bearer ${login.preAuthToken}`)
      .send({ code: definitelyWrongCode(secret) })
      .expect(401);

    expect(users[adminId].twoFactorEnabled).toBe(false);
    expect(mailMock.sendAdminLoginAlert).not.toHaveBeenCalled();
  });

  it("verify: wrong code → 401, valid code → JWT + alert, pre-auth burned", async () => {
    const { secret } = await enrolAdmin();
    // enrolment itself completed a login (and alerted); start counting fresh
    mailMock.sendAdminLoginAlert.mockClear();

    const login = await loginAdmin();
    expect(login.twoFactorRequired).toBe(true);

    await adminVerify(login.preAuthToken, definitelyWrongCode(secret)).expect(401);
    // failed attempt keeps the token usable inside its TTL
    expect(users[adminId].twoFactorPreAuthHash).toBe(
      sha256(login.preAuthToken),
    );

    const ok = await adminVerify(login.preAuthToken, generateTotp(secret)).expect(201);
    expect((ok.body as { accessToken: string }).accessToken).toBeTruthy();
    expect(mailMock.sendAdminLoginAlert).toHaveBeenCalledTimes(1);

    // single-use: the same token cannot mint a second session
    await adminVerify(login.preAuthToken, generateTotp(secret)).expect(401);
  });

  it("a newer login supersedes an older pre-auth token", async () => {
    const { secret } = await enrolAdmin();

    const first = await loginAdmin();
    const second = await loginAdmin();

    await adminVerify(first.preAuthToken, generateTotp(secret)).expect(401);
    await adminVerify(second.preAuthToken, generateTotp(secret)).expect(201);
  });

  it("an expired pre-auth token is rejected", async () => {
    const { secret } = await enrolAdmin();
    const login = await loginAdmin();

    users[adminId].twoFactorPreAuthExp = new Date(Date.now() - 1000);

    await adminVerify(login.preAuthToken, generateTotp(secret)).expect(401);
  });

  it("recovery codes work exactly once", async () => {
    const { secret, recoveryCodes } = await enrolAdmin();
    const recovery = recoveryCodes[0];

    const first = await loginAdmin();
    const used = await adminVerify(first.preAuthToken, recovery).expect(201);
    expect((used.body as { accessToken: string }).accessToken).toBeTruthy();

    const second = await loginAdmin();
    await adminVerify(second.preAuthToken, recovery).expect(401);

    // a fresh code still works after the burned one fails
    const third = await loginAdmin();
    await adminVerify(third.preAuthToken, recoveryCodes[1]).expect(201);
    expect(verifyTotp(secret, generateTotp(secret))).toBe(true);
  });

  it("disable needs password AND code, then the mandate re-bites", async () => {
    const { secret, accessToken } = await enrolAdmin();

    await request(app.getHttpServer())
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "wrong-password", code: generateTotp(secret) })
      .expect(401);

    await request(app.getHttpServer())
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD, code: definitelyWrongCode(secret) })
      .expect(401);

    const off = await request(app.getHttpServer())
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD, code: generateTotp(secret) })
      .expect(201);
    expect((off.body as { twoFactorEnabled: boolean }).twoFactorEnabled).toBe(false);

    expect(users[adminId].twoFactorEnabled).toBe(false);
    expect(users[adminId].twoFactorSecret).toBeNull();
    expect(users[adminId].twoFactorRecoveryCodes).toBeNull();

    // next login demands enrolment again — the rule is per-account, not once
    const relogin = await loginAdmin();
    expect(relogin.twoFactorSetupRequired).toBe(true);
  });

  it("disable also accepts a recovery code (lost-device path)", async () => {
    const { recoveryCodes, accessToken } = await enrolAdmin();

    const off = await request(app.getHttpServer())
      .post("/auth/2fa/disable")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: PASSWORD, code: recoveryCodes[0] })
      .expect(201);
    expect((off.body as { twoFactorEnabled: boolean }).twoFactorEnabled).toBe(false);
    expect(users[adminId].twoFactorEnabled).toBe(false);
  });

  it("refuses enrolment for non-admin accounts", async () => {
    const buyerLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "buyer@bonagri.co.za", password: PASSWORD })
      .expect(201);
    const buyerToken = (buyerLogin.body as { accessToken: string }).accessToken;

    const setup = await request(app.getHttpServer())
      .post("/auth/2fa/setup")
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(403);
    expect((setup.body as { message: string }).message).toMatch(/admin-only/i);
  });

  it("an enrolled admin cannot re-setup without disabling first", async () => {
    const { accessToken } = await enrolAdmin();

    await request(app.getHttpServer())
      .post("/auth/2fa/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(409);
  });

  it("JwtAuthGuard treats a type=pre-auth payload as unauthenticated (defence in depth)", async () => {
    const validateUser = jest.fn();
    const guard = new JwtAuthGuard(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: adminId,
          type: "pre-auth",
          purpose: "2fa",
        }),
      } as never,
      { validateUser } as never,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: "Bearer x" } }),
      }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toThrow(
      /invalid or expired token/i,
    );
    expect(validateUser).not.toHaveBeenCalled();
  });
});
