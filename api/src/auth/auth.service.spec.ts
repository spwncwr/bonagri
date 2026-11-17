import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { AuthService } from "./auth.service";

// The resetPassword tests deliberately exercise bcrypt cost 12 (the real
// production setting, pinned by assertion) — ~1s of CPU on an idle box and
// easily 5s+ on a loaded dev machine. The default 5s jest budget flakes
// there, so give the file a realistic ceiling; assertions are unchanged.
jest.setTimeout(15_000);

function makeService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // HP5: resetPassword revokes live sessions in the same transaction;
    // the refresh specs exercise the rest of this model.
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // resetPassword passes an ARRAY of ops (see verifyEmail for the shape)
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue("token"),
  };
  const mail = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new AuthService(
      prisma as never,
      jwt as never,
      mail as never,
    ),
    prisma,
    mail,
  };
}

describe("AuthService.getMe (settings payload)", () => {
  it("returns the account plus both role profiles in one read", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "dev@bonagri.co.za",
      firstName: "Dev",
      lastName: "Vendor",
      phone: "015 000 0000",
      avatarUrl: "https://res.cloudinary.com/demo/image/upload/v1/a.png",
      role: "SUPPLIER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      supplierProfile: {
        businessName: "Marula Fresh",
        description: null,
        registrationNo: null,
        phone: null,
        email: null,
        address: null,
        city: "Tzaneen",
        province: "Limpopo",
        logoUrl: null,
        verified: true,
      },
      transporterProfile: null,
    });

    const me = await service.getMe("user-1");

    expect(me.avatarUrl).toContain("res.cloudinary.com");
    expect(me.supplierProfile).toMatchObject({
      businessName: "Marula Fresh",
      verified: true,
    });
    expect(me.transporterProfile).toBeNull();
    // the query must ask for both relations so one payload serves every role
    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select.avatarUrl).toBe(true);
    expect(select.supplierProfile.select).toMatchObject({
      businessName: true,
      verified: true,
    });
    expect(select.transporterProfile.select).toMatchObject({
      vehicleType: true,
      serviceProvinces: true,
    });
  });

  it("404s when the account no longer exists", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe("ghost")).rejects.toThrow(NotFoundException);
  });
});

// HP4: forgot-password must be indistinguishable for known and unknown
// addresses — the generic 202 body is the whole anti-enumeration contract.
describe("AuthService.forgotPassword (HP4, no account enumeration)", () => {
  const genericResponse = {
    message:
      "If an account exists for that email, a password reset link has been sent.",
    passwordResetRequested: true,
  };

  it("answers identically and creates nothing for an unknown address", async () => {
    const { service, prisma, mail } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.forgotPassword("  Ghost@Example.COM ");

    expect(result).toEqual(genericResponse);
    // lookup normalizes exactly like login/resend do
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "ghost@example.com" } }),
    );
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("stores only the SHA-256 hash with a 30-minute TTL and burns older links", async () => {
    const { service, prisma, mail } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      firstName: "Buyer",
    });

    const before = Date.now();
    const result = await service.forgotPassword("buyer@example.com");

    expect(result).toEqual(genericResponse);
    // a second request invalidates the first link (single live token)
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
    expect(created.userId).toBe("user-1");
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttlMs = created.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);

    // the raw token exists ONLY in the emailed link, and it hashes to the row
    const resetUrl: string = mail.sendPasswordResetEmail.mock.calls[0][2];
    expect(resetUrl).toContain("/reset-password?token=");
    const rawToken = new URL(resetUrl).searchParams.get("token");
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(rawToken!).digest("hex")).toBe(
      created.tokenHash,
    );
    expect(resetUrl).not.toContain(created.tokenHash);
  });

  it("keeps the identical response when mail delivery fails", async () => {
    const { service, prisma, mail } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "buyer@example.com",
      firstName: "Buyer",
    });
    mail.sendPasswordResetEmail.mockRejectedValueOnce(
      new Error("smtp down"),
    );
    // an SMTP error must reach the logs, not the HTTP response — otherwise a
    // 500 for existing addresses only would re-open the enumeration oracle
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.forgotPassword("buyer@example.com"),
      ).resolves.toEqual(genericResponse);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

// HP4: the reset link is the only credential here — unknown, expired and
// already-used tokens must all fail identically, and success must swap the
// hash and kill the link in one shot.
describe("AuthService.resetPassword (HP4, single-use link)", () => {
  const presentedToken = "c".repeat(64);
  const genericError = "This reset link is invalid or has expired";

  function mockLookup(overrides: Record<string, unknown> = {}) {
    const { service, prisma, mail } = makeService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides,
    });
    return { service, prisma, mail };
  }

  it("rejects unknown, expired and reused links with one generic error", async () => {
    // unknown token hash — BadRequestException is what maps to HTTP 400
    const unknown = makeService();
    unknown.prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      unknown.service.resetPassword({
        token: presentedToken,
        password: "brand-new-pass",
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      unknown.service.resetPassword({
        token: presentedToken,
        password: "brand-new-pass",
      }),
    ).rejects.toThrow(genericError);

    // expired
    const expired = mockLookup({
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(
      expired.service.resetPassword({
        token: presentedToken,
        password: "brand-new-pass",
      }),
    ).rejects.toThrow(genericError);

    // already used
    const reused = mockLookup({ usedAt: new Date() });
    await expect(
      reused.service.resetPassword({
        token: presentedToken,
        password: "brand-new-pass",
      }),
    ).rejects.toThrow(genericError);

    for (const { prisma } of [unknown, expired, reused]) {
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it("looks the link up by SHA-256 hash, never by the raw token", async () => {
    const { service, prisma } = mockLookup();

    await service.resetPassword({
      token: presentedToken,
      password: "brand-new-pass",
    });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: createHash("sha256")
            .update(presentedToken)
            .digest("hex"),
        },
      }),
    );
  });

  it("swaps the password hash and burns the token in ONE transaction", async () => {
    const { service, prisma } = mockLookup();

    const result = await service.resetPassword({
      token: presentedToken,
      password: "brand-new-pass",
    });

    expect(result).toMatchObject({ passwordUpdated: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const userUpdate = prisma.user.update.mock.calls[0][0];
    expect(userUpdate.where).toEqual({ id: "user-1" });
    // bcrypt cost 12, matching register()
    expect(userUpdate.data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(userUpdate.data.passwordHash).not.toBe("brand-new-pass");
    expect(
      await bcrypt.compare("brand-new-pass", userUpdate.data.passwordHash),
    ).toBe(true);
    expect(
      await bcrypt.compare("previous-password", userUpdate.data.passwordHash),
    ).toBe(false);

    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reset-1" },
        data: { usedAt: expect.any(Date) },
      }),
    );

    // ONLY the hash may change: no status/emailVerifiedAt — resetting a
    // password must never un-suspend an account or verify an email.
    expect(Object.keys(userUpdate.data)).toEqual(["passwordHash"]);
  });

  it("revokes every live refresh session in the same transaction (HP5)", async () => {
    const { service, prisma } = mockLookup();

    await service.resetPassword({
      token: presentedToken,
      password: "brand-new-pass",
    });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    // and it rides the SAME $transaction as the password swap
    const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(3);
  });
});
