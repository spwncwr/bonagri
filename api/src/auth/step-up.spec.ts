import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { createHash } from "node:crypto";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AdminController } from "../admin/admin.controller";
import { AdminService } from "../admin/admin.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";

// HP3 (plan G3): the step-up contract, exercised through the real
// controllers, real AuthService and real StepUpGuard — only Prisma and mail
// are in-memory mocks. The admin mutation itself is mocked so these tests
// pin the GUARD, not AdminService (whose audit rows are covered in
// admin.service.spec.ts).

const TEST_SECRET = "test-secret";
const PASSWORD = "password123";

// Derived exactly like AuthService.stepUpSecret — one test-side copy so a
// change to the derivation breaks this spec instead of silently weakening it.
const STEP_UP_SECRET = createHash("sha256")
  .update(`${TEST_SECRET}:step-up`)
  .digest("hex");

describe("HP3 step-up confirmation (G3)", () => {
  let app: INestApplication;

  const adminId = "admin-1";
  const buyerId = "buyer-1";

  const users: Record<string, Record<string, unknown>> = {};
  const adminServiceMock = {
    updateUserStatus: jest.fn(),
  };

  // The access token's provenance is covered by HP2's login/2FA specs; here
  // it only has to round-trip JwtAuthGuard (same secret as production).
  function signAccessToken(sub: string) {
    return new JwtService({ secret: TEST_SECRET }).sign({ sub });
  }

  function signStepUp(sub: string, expiresIn: number = 300) {
    return new JwtService({ secret: TEST_SECRET }).sign(
      { sub, type: "step-up" },
      { secret: STEP_UP_SECRET, expiresIn },
    );
  }

  function stepUpRequest(bearer: string, password: string = PASSWORD) {
    return request(app.getHttpServer())
      .post("/auth/step-up")
      .set("Authorization", `Bearer ${bearer}`)
      .send({ password });
  }

  function patchStatus(options: {
    bearer?: string;
    stepUp?: string;
    status?: string;
  }) {
    const req = request(app.getHttpServer())
      .patch("/admin/users/user-2/status")
      .send({ status: options.status ?? "SUSPENDED" });

    if (options.bearer) {
      req.set("Authorization", `Bearer ${options.bearer}`);
    }
    if (options.stepUp !== undefined) {
      req.set("X-Step-Up", options.stepUp);
    }

    return req;
  }

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    jest.clearAllMocks();
    adminServiceMock.updateUserStatus.mockResolvedValue({
      id: "user-2",
      status: "SUSPENDED",
    });

    users[adminId] = {
      id: adminId,
      email: "admin@bonagri.co.za",
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      firstName: "Ada",
      lastName: "Admin",
      phone: null,
      avatarUrl: null,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    };
    users[buyerId] = {
      id: buyerId,
      email: "buyer@bonagri.co.za",
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      firstName: "Ben",
      lastName: "Buyer",
      phone: null,
      avatarUrl: null,
      role: "BUYER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    };

    const prismaMock = {
      user: {
        findUnique: jest.fn(
          async ({ where }: { where: { id?: string; email?: string } }) => {
            const found = where.id
              ? users[where.id]
              : Object.values(users).find(
                  (user) => user.email === where.email,
                );
            return found ? { ...found } : null;
          },
        ),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        // Mirror AppModule: module default 120/min, per-route override on
        // step-up (auth.controller.ts).
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 120 }],
        }),
        // Real JWT so tokens round-trip exactly as in production; the step-up
        // secret derives from JWT_SECRET.
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: 86400 },
        }),
      ],
      controllers: [AuthController, AdminController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: MailService,
          useValue: {
            sendAdminLoginAlert: jest.fn().mockResolvedValue(undefined),
            sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AdminService, useValue: adminServiceMock },
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

  describe("POST /auth/step-up", () => {
    it("issues a 5-minute step-up token for the correct password", async () => {
      const response = await stepUpRequest(signAccessToken(buyerId)).expect(
        201,
      );

      const body = response.body as { stepUpToken: string; expiresIn: number };
      expect(body.expiresIn).toBe(300);
      expect(body.stepUpToken).toBeTruthy();

      // The token carries the step-up type and the exact TTL — decodable
      // with the derived secret only.
      const payload = new JwtService({ secret: TEST_SECRET }).decode<{
        sub: string;
        type: string;
        iat: number;
        exp: number;
      }>(body.stepUpToken);
      expect(payload?.type).toBe("step-up");
      expect(payload?.sub).toBe(buyerId);
      expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(300);
    });

    it("works for an admin too (any signed-in user may re-prove)", async () => {
      const response = await stepUpRequest(signAccessToken(adminId)).expect(
        201,
      );
      expect(
        (response.body as { stepUpToken: string }).stepUpToken,
      ).toBeTruthy();
    });

    it("rejects a wrong password with 401 and issues nothing", async () => {
      await stepUpRequest(signAccessToken(adminId), "wrong-password").expect(
        401,
      );
    });

    it("rejects an unauthenticated call with 401", async () => {
      await request(app.getHttpServer())
        .post("/auth/step-up")
        .send({ password: PASSWORD })
        .expect(401);
    });

    it("rejects a password shorter than 8 chars with 400", async () => {
      await stepUpRequest(signAccessToken(adminId), "short").expect(400);
    });

    it("throttles password checks to 10 per minute", async () => {
      const bearer = signAccessToken(buyerId);

      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await stepUpRequest(bearer).expect(201);
      }

      await stepUpRequest(bearer).expect(429);
    });
  });

  describe("StepUpGuard on a guarded admin mutation", () => {
    it("403s with STEP_UP_REQUIRED when the header is missing", async () => {
      const response = await patchStatus({
        bearer: signAccessToken(adminId),
      }).expect(403);
      expect(response.body).toMatchObject({
        statusCode: 403,
        code: "STEP_UP_REQUIRED",
      });
      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("403s on a forged or garbage header", async () => {
      const forged = new JwtService({ secret: TEST_SECRET }).sign({
        sub: adminId,
        type: "step-up",
      });

      for (const stepUp of [forged, "not-a-token", ""]) {
        const response = await patchStatus({
          bearer: signAccessToken(adminId),
          stepUp,
        }).expect(403);
        expect(response.body).toMatchObject({ code: "STEP_UP_REQUIRED" });
      }

      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("403s on an expired step-up token", async () => {
      const response = await patchStatus({
        bearer: signAccessToken(adminId),
        stepUp: signStepUp(adminId, -10),
      }).expect(403);

      expect(response.body).toMatchObject({ code: "STEP_UP_REQUIRED" });
      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("403s when the step-up belongs to a different account", async () => {
      const response = await patchStatus({
        bearer: signAccessToken(adminId),
        stepUp: signStepUp(buyerId),
      }).expect(403);

      expect(response.body).toMatchObject({ code: "STEP_UP_REQUIRED" });
      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("401s without an access token regardless of step-up header", async () => {
      await patchStatus({ stepUp: signStepUp(adminId) }).expect(401);
      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("never lets a non-admin through, even with a valid step-up", async () => {
      const response = await patchStatus({
        bearer: signAccessToken(buyerId),
        stepUp: signStepUp(buyerId),
      }).expect(403);

      expect(response.body).not.toHaveProperty("code", "STEP_UP_REQUIRED");
      expect(adminServiceMock.updateUserStatus).not.toHaveBeenCalled();
    });

    it("passes with a valid step-up and passes the audit context", async () => {
      const bearer = signAccessToken(adminId);
      const stepUp = signStepUp(adminId);

      await patchStatus({ bearer, stepUp }).expect(200);

      expect(adminServiceMock.updateUserStatus).toHaveBeenCalledWith(
        "user-2",
        { status: "SUSPENDED" },
        expect.objectContaining({ actorUserId: adminId }),
      );
    });

    it("reuses the same step-up for a second action (not single-use)", async () => {
      const bearer = signAccessToken(adminId);
      const stepUp = signStepUp(adminId);

      await patchStatus({ bearer, stepUp }).expect(200);
      await patchStatus({ bearer, stepUp, status: "ACTIVE" }).expect(200);

      expect(adminServiceMock.updateUserStatus).toHaveBeenCalledTimes(2);
    });
  });
});
