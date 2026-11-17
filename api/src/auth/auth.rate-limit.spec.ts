import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

// CP13: the login/register budgets are security numbers, so they are pinned
// here: a future edit that loosens them has to consciously update this spec.
// The buckets are per-route, so exhausting login must not affect register.
describe("Auth rate limiting (ThrottlerGuard)", () => {
  let app: INestApplication;

  const authServiceMock = {
    login: jest.fn().mockResolvedValue({ accessToken: "token" }),
    register: jest.fn().mockResolvedValue({ user: { id: "u1" } }),
    verify2fa: jest.fn().mockResolvedValue({ accessToken: "token" }),
    forgotPassword: jest.fn().mockResolvedValue({
      message: "If an account exists for that email, a password reset link has been sent.",
      passwordResetRequested: true,
    }),
    resetPassword: jest.fn().mockResolvedValue({ passwordUpdated: true }),
  };

  beforeEach(async () => {
    authServiceMock.login.mockClear();
    authServiceMock.register.mockClear();
    authServiceMock.verify2fa.mockClear();
    authServiceMock.forgotPassword.mockClear();
    authServiceMock.resetPassword.mockClear();

    const moduleRef = await Test.createTestingModule({
      imports: [
        // Mirror AppModule: module default 120/min, per-route overrides on
        // the credential routes (see auth.controller.ts).
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 120 }],
        }),
      ],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

  it("allows 15 logins per minute, then blocks the 16th with 429", async () => {
    const body = { email: "user@example.com", password: "password123" };

    for (let attempt = 1; attempt <= 15; attempt += 1) {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send(body)
        .expect(201);
    }

    await request(app.getHttpServer()).post("/auth/login").send(body).expect(429);

    expect(authServiceMock.login).toHaveBeenCalledTimes(15);
  });

  it("keeps a separate budget per route — a throttled login does not block register", async () => {
    const loginBody = { email: "user@example.com", password: "password123" };

    for (let attempt = 1; attempt <= 16; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post("/auth/login")
        .send(loginBody);

      if (attempt <= 15) {
        expect(response.status).toBe(201);
      }
    }

    await request(app.getHttpServer()).post("/auth/login").send(loginBody).expect(429);

    // Register has its own bucket (10/min) and must still accept the request.
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email: "new@example.com",
        password: "password123",
        firstName: "New",
        lastName: "User",
        phone: "0123456789",
      })
      .expect(201);

    expect(authServiceMock.register).toHaveBeenCalledTimes(1);
  });

  it("allows 10 two-factor verifications per minute, then blocks with 429", async () => {
    // HP2: /auth/2fa/verify is the code-guessing surface — its budget is a
    // security number (10/min), tighter than login's 15/min.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await request(app.getHttpServer())
        .post("/auth/2fa/verify")
        .set("Authorization", "Bearer pre-auth-token")
        .send({ code: "123456" })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post("/auth/2fa/verify")
      .set("Authorization", "Bearer pre-auth-token")
      .send({ code: "123456" })
      .expect(429);

    expect(authServiceMock.verify2fa).toHaveBeenCalledTimes(10);
  });

  it("allows 5 password resets per minute, then blocks with 429", async () => {
    // HP4: /auth/forgot-password triggers outbound email — spam surface, so
    // it is budgeted like resend-verification (5/min). It must also answer
    // 202, never 201: the accepted response is part of the no-enumeration
    // contract (identical body whether or not the address exists).
    const body = { email: "user@example.com" };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(app.getHttpServer())
        .post("/auth/forgot-password")
        .send(body)
        .expect(202);
    }

    await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send(body)
      .expect(429);

    expect(authServiceMock.forgotPassword).toHaveBeenCalledTimes(5);
  });

  it("allows 10 reset-link submissions per minute, then blocks with 429", async () => {
    // HP4: /auth/reset-password is the token-guessing surface — 10/min.
    const body = { token: "a".repeat(64), password: "password123" };

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await request(app.getHttpServer())
        .post("/auth/reset-password")
        .send(body)
        .expect(201);
    }

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send(body)
      .expect(429);

    expect(authServiceMock.resetPassword).toHaveBeenCalledTimes(10);
  });
});
