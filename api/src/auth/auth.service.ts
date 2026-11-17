import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { UserRole } from "../common/types";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import {
  buildOtpauthUri,
  generateBase32Secret,
  verifyTotp,
} from "./totp";

// HP2: how long the password-verified pre-auth token lives (login → 2FA code
// or enrolment completion). It can mint at most ONE JWT: the hash stored at
// issuance is cleared when the JWT is handed out, so a captured token is
// single-use while still allowing retries inside the window.
const PRE_AUTH_TTL_MS = 5 * 60 * 1000;
// HP3: how long a step-up confirmation lasts. Deliberately NOT single-use —
// one password re-entry may cover several quick dangerous actions.
const STEP_UP_TTL_MS = 5 * 60 * 1000;
// HP4: how long a password-reset link lives. Single-use and short-lived, and
// only its SHA-256 hash is persisted, so an inbox leak or a DB dump alone is
// not enough to take over an account.
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

type PreAuthPurpose = "2fa" | "setup";

type PreAuthPayload = {
  sub: string;
  type: "pre-auth";
  purpose: PreAuthPurpose;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifiedAt: true,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        "An account with this email already exists",
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim(),
        role: "BUYER",
        emailVerificationTokens: {
          create: {
            tokenHash,
            expiresAt,
          },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
      },
    });

    const webBaseUrl =
      process.env.WEB_BASE_URL ?? "http://localhost:3001";

    const verificationUrl =
      `${webBaseUrl}/verify-email?token=${verificationToken}`;

    try {
      await this.mailService.sendVerificationEmail(
        user.email,
        user.firstName,
        verificationUrl,
      );
    } catch (error) {
      await this.prisma.user.delete({
        where: { id: user.id },
      });

      throw error;
    }

    return {
      message:
        "Account created. Please check your email to verify your account.",
      emailVerificationRequired: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    };
  }

  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);

    const verificationToken =
      await this.prisma.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              status: true,
              emailVerifiedAt: true,
            },
          },
        },
      });

    if (!verificationToken) {
      throw new UnauthorizedException(
        "Invalid or expired verification link",
      );
    }

    if (
      verificationToken.usedAt ||
      verificationToken.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        "Invalid or expired verification link",
      );
    }

    if (verificationToken.user.emailVerifiedAt) {
      return {
        message: "Email address is already verified.",
        emailVerified: true,
      };
    }

    const verifiedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: verificationToken.user.id },
        data: {
          emailVerifiedAt: verifiedAt,
        },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: verificationToken.id },
        data: {
          usedAt: verifiedAt,
        },
      }),
    ]);

    return {
      message: "Email address verified successfully.",
      emailVerified: true,
    };
  }

  async resendVerificationEmail(emailInput: string) {
    const email = emailInput.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        emailVerifiedAt: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        "Unable to resend verification email",
      );
    }

    if (user.emailVerifiedAt) {
      return {
        message: "Email address is already verified.",
        emailVerified: true,
      };
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException(
        "User account is not active",
      );
    }

    await this.prisma.emailVerificationToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    const verificationToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const webBaseUrl =
      process.env.WEB_BASE_URL ?? "http://localhost:3001";

    const verificationUrl =
      `${webBaseUrl}/verify-email?token=${verificationToken}`;

    await this.mailService.sendVerificationEmail(
      user.email,
      user.firstName,
      verificationUrl,
    );

    return {
      message: "A new verification email has been sent.",
      emailVerificationRequired: true,
    };
  }

  // ---------- HP4: account recovery (plan G4) ----------

  // Always answers the same 202 body — for unknown addresses, unverified
  // accounts and mail-delivery failures alike — so this route can never be
  // used to enumerate accounts. The generic message is the only contract the
  // web UI relies on.
  async forgotPassword(emailInput: string) {
    const email = emailInput.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true },
    });

    if (user) {
      // Only the newest link may work: burn anything still outstanding.
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const resetToken = randomBytes(32).toString("hex");
      const tokenHash = this.hashToken(resetToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const webBaseUrl =
        process.env.WEB_BASE_URL ?? "http://localhost:3001";

      const resetUrl =
        `${webBaseUrl}/reset-password?token=${resetToken}`;

      try {
        await this.mailService.sendPasswordResetEmail(
          user.email,
          user.firstName,
          resetUrl,
        );
      } catch (error) {
        // Swallow it: an SMTP failure would otherwise answer 500 only for
        // registered addresses — a live enumeration oracle. Operators still
        // see it in the logs.
        console.error("BonAgri password reset email delivery error:", error);
      }
    }

    return {
      message:
        "If an account exists for that email, a password reset link has been sent.",
      passwordResetRequested: true,
    };
  }

  // Consumes a single-use link: unknown, already-used and expired tokens all
  // fail with the SAME generic error so probing the endpoint learns nothing.
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        "This reset link is invalid or has expired",
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // One transaction: the password changes and the link dies together, so a
    // replay can never race a half-consumed reset.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // HP5 not landed yet: there are no refresh tokens/sessions to revoke —
    // when HP5 adds them, kill them HERE. status/emailVerifiedAt are
    // deliberately untouched: resetting a password must never let a
    // SUSPENDED account past the login gates or verify an email.

    return {
      message: "Password updated. You can now sign in with your new password.",
      passwordUpdated: true,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
      },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Please verify your email address before signing in",
      );
    }

    // HP2: admin sign-in is two-step — the password alone never yields a JWT.
    // Enrolled admins get the "enter your code" step; unenrolled admins get
    // the mandatory-enrolment step (same pre-auth token, different purpose).
    if (user.role === "ADMIN") {
      const purpose: PreAuthPurpose = user.twoFactorEnabled ? "2fa" : "setup";
      const preAuthToken = await this.issuePreAuthToken(user.id, purpose);

      return user.twoFactorEnabled
        ? { twoFactorRequired: true, preAuthToken }
        : { twoFactorSetupRequired: true, preAuthToken };
    }

    return this.issueToken(user);
  }

  // ---------- HP2: mandatory admin 2FA (TOTP) ----------

  // The pre-auth token is signed with a derived secret so it can NEVER pass
  // JwtAuthGuard (which verifies against the main secret), and it carries the
  // stored-hash check below so it is single-use at JWT-minting time.
  private preAuthSecret() {
    const base = process.env.JWT_SECRET ?? "";
    return createHash("sha256").update(`${base}:2fa-preauth`).digest("hex");
  }

  private async issuePreAuthToken(userId: string, purpose: PreAuthPurpose) {
    const token = await this.jwtService.signAsync(
      // jti makes every issuance unique — two logins in the same second must
      // not produce byte-identical tokens (the stored hash decides which one
      // is current).
      {
        sub: userId,
        type: "pre-auth",
        purpose,
        jti: randomBytes(16).toString("hex"),
      } satisfies PreAuthPayload & { jti: string },
      { secret: this.preAuthSecret(), expiresIn: PRE_AUTH_TTL_MS / 1000 },
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorPreAuthHash: this.hashToken(token),
        twoFactorPreAuthExp: new Date(Date.now() + PRE_AUTH_TTL_MS),
      },
    });

    return token;
  }

  // Signature (derived secret) + stored hash + expiry. Throws 401 on any
  // mismatch — wrong purpose, expired, superseded by a newer login, or
  // already consumed by a successful verify.
  private async resolvePreAuth(
    authorization: string | undefined,
    expectedPurpose: PreAuthPurpose,
  ): Promise<string> {
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Pre-auth token required");
    }
    const token = authorization.slice(7);

    let payload: PreAuthPayload;
    try {
      payload = await this.jwtService.verifyAsync<PreAuthPayload>(token, {
        secret: this.preAuthSecret(),
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired sign-in token");
    }

    if (
      payload.type !== "pre-auth" ||
      payload.purpose !== expectedPurpose ||
      typeof payload.sub !== "string"
    ) {
      throw new UnauthorizedException("Invalid or expired sign-in token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        twoFactorPreAuthHash: true,
        twoFactorPreAuthExp: true,
      },
    });

    const storedHash = user?.twoFactorPreAuthHash ?? "";
    const givenHash = this.hashToken(token);
    const hashMatches =
      storedHash.length === givenHash.length &&
      timingSafeEqual(Buffer.from(storedHash), Buffer.from(givenHash));
    const unexpired =
      user?.twoFactorPreAuthExp != null &&
      user.twoFactorPreAuthExp.getTime() > Date.now();

    if (!hashMatches || !unexpired) {
      throw new UnauthorizedException("Invalid or expired sign-in token");
    }

    return payload.sub;
  }

  // Public so TwoFactorSetupGuard can do full pre-auth validation
  // (signature + stored hash + expiry) once per request; setup/enable then
  // trust the resolved actor. Returns which token kind authenticated.
  async resolveSetupActor(
    authorization: string | undefined,
  ): Promise<{ id: string; viaPreAuth: boolean }> {
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice(7);

      // Try the pre-auth token first (derived secret — an access token
      // cannot satisfy it, and a pre-auth token cannot satisfy the guard).
      try {
        const payload = await this.jwtService.verifyAsync<PreAuthPayload>(
          token,
          { secret: this.preAuthSecret() },
        );
        if (
          payload.type === "pre-auth" &&
          payload.purpose === "setup" &&
          typeof payload.sub === "string"
        ) {
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
              twoFactorPreAuthHash: true,
              twoFactorPreAuthExp: true,
            },
          });
          const storedHash = user?.twoFactorPreAuthHash ?? "";
          const givenHash = this.hashToken(token);
          const hashMatches =
            storedHash.length === givenHash.length &&
            timingSafeEqual(Buffer.from(storedHash), Buffer.from(givenHash));
          const unexpired =
            user?.twoFactorPreAuthExp != null &&
            user.twoFactorPreAuthExp.getTime() > Date.now();

          if (hashMatches && unexpired) {
            return { id: payload.sub, viaPreAuth: true };
          }
          throw new UnauthorizedException("Invalid or expired sign-in token");
        }
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        // fall through to the access-token path below
      }

      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string }>(
          token,
        );
        if (typeof payload.sub === "string") {
          return { id: payload.sub, viaPreAuth: false };
        }
      } catch {
        // fall through
      }
    }

    throw new UnauthorizedException("Invalid or expired token");
  }

  // POST /auth/2fa/setup — generate (or re-generate before enable) the
  // pending secret. Called from the mandatory-enrolment redirect or from
  // /admin/security while already signed in.
  async setup2fa(actor: { id: string; viaPreAuth: boolean }) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        email: true,
        role: true,
        twoFactorEnabled: true,
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Two-factor enrolment is admin-only");
    }
    if (user.twoFactorEnabled) {
      throw new ConflictException(
        "Two-factor is already enabled — disable it first to re-enrol",
      );
    }

    const secret = generateBase32Secret();

    await this.prisma.user.update({
      where: { id: actor.id },
      data: { twoFactorSecret: secret },
    });

    return {
      secret,
      otpauthUri: buildOtpauthUri(secret, user.email),
      accountLabel: user.email,
    };
  }

  // POST /auth/2fa/enable — the code proves the authenticator app saw the
  // secret; this is also where a mandatory-enrolment login completes (the
  // pre-auth caller receives its JWT here).
  async enable2fa(
    actor: { id: string; viaPreAuth: boolean },
    code: string,
    meta: { ip?: string } = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorPreAuthHash: true,
        twoFactorPreAuthExp: true,
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Two-factor enrolment is admin-only");
    }
    if (user.twoFactorEnabled) {
      throw new ConflictException("Two-factor is already enabled");
    }
    if (!user.twoFactorSecret) {
      throw new BadRequestException("Run two-factor setup first");
    }
    if (!verifyTotp(user.twoFactorSecret, code)) {
      throw new UnauthorizedException(
        "Invalid authentication code — check your authenticator app and try again",
      );
    }

    const recoveryCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      () => randomBytes(6).toString("hex").toUpperCase(),
    );

    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        twoFactorEnabled: true,
        twoFactorEnabledAt: new Date(),
        twoFactorRecoveryCodes: JSON.stringify(
          recoveryCodes.map((recoveryCode) => this.hashToken(recoveryCode)),
        ),
        twoFactorPreAuthHash: null,
        twoFactorPreAuthExp: null,
      },
    });

    const result: {
      recoveryCodes: string[];
      twoFactorEnabled: true;
      accessToken?: string;
      user?: unknown;
    } = { recoveryCodes, twoFactorEnabled: true };

    // Enrolment-as-login: the password was checked moments ago, so completing
    // the flow hands back the real session (plus the sign-in alert).
    if (actor.viaPreAuth) {
      const session = await this.issueToken(user);
      result.accessToken = session.accessToken;
      result.user = session.user;
      await this.sendLoginAlert(user, meta.ip);
    }

    return result;
  }

  // POST /auth/2fa/verify — pre-auth token + TOTP (or recovery code) → JWT.
  // The pre-auth hash is burned only on success, so wrong attempts can be
  // retried inside the TTL but a captured token mints at most one session.
  async verify2fa(
    authorization: string | undefined,
    code: string,
    meta: { ip?: string } = {},
  ) {
    const userId = await this.resolvePreAuth(authorization, "2fa");

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorRecoveryCodes: true,
      },
    });

    if (!user || !user.twoFactorEnabled || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Invalid or expired sign-in token");
    }

    const candidate = code.trim();
    let nextRecoveryCodes: string | null = null;

    if (/^\d{6}$/.test(candidate)) {
      if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, candidate)) {
        throw new UnauthorizedException("Invalid authentication code");
      }
    } else {
      const hashes = this.parseRecoveryCodes(user.twoFactorRecoveryCodes);
      const candidateHash = this.hashToken(
        candidate.replace(/[\s-]/g, "").toUpperCase(),
      );
      const index = hashes.findIndex(
        (stored) =>
          stored.length === candidateHash.length &&
          timingSafeEqual(Buffer.from(stored), Buffer.from(candidateHash)),
      );
      if (index === -1) {
        throw new UnauthorizedException("Invalid authentication code");
      }
      hashes.splice(index, 1);
      nextRecoveryCodes = JSON.stringify(hashes);
    }

    // Success — burn the pre-auth (single-use) and rotate a consumed recovery
    // code in the same write.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorPreAuthHash: null,
        twoFactorPreAuthExp: null,
        ...(nextRecoveryCodes !== null
          ? { twoFactorRecoveryCodes: nextRecoveryCodes }
          : {}),
      },
    });

    await this.sendLoginAlert(user, meta.ip);

    return this.issueToken(user);
  }

  // POST /auth/2fa/disable — password AND a current code (TOTP, or a
  // recovery code for the lost-device path). Admin-only, re-checked in the
  // service per house convention.
  async disable2fa(userId: string, dto: { password: string; code: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorRecoveryCodes: true,
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("Two-factor is admin-only");
    }
    if (!user.twoFactorEnabled) {
      throw new BadRequestException("Two-factor is not enabled");
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid password");
    }

    const candidate = dto.code.trim();
    let codeValid: boolean;

    if (/^\d{6}$/.test(candidate)) {
      codeValid = Boolean(
        user.twoFactorSecret && verifyTotp(user.twoFactorSecret, candidate),
      );
    } else {
      const hashes = this.parseRecoveryCodes(user.twoFactorRecoveryCodes);
      const candidateHash = this.hashToken(
        candidate.replace(/[\s-]/g, "").toUpperCase(),
      );
      const matched = hashes.find(
        (stored) =>
          stored.length === candidateHash.length &&
          timingSafeEqual(Buffer.from(stored), Buffer.from(candidateHash)),
      );
      if (matched) {
        const next = hashes.filter((stored) => stored !== matched);
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorRecoveryCodes: JSON.stringify(next) },
        });
      }
      codeValid = Boolean(matched);
    }

    if (!codeValid) {
      throw new UnauthorizedException("Invalid authentication code");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: null,
        twoFactorEnabledAt: null,
        twoFactorPreAuthHash: null,
        twoFactorPreAuthExp: null,
      },
    });

    return {
      twoFactorEnabled: false,
      message:
        "Two-factor authentication is off. Your recovery codes are no longer valid.",
    };
  }

  private parseRecoveryCodes(stored: string | null): string[] {
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored) as unknown;
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  // Best-effort: a failed alert email must never block a successful sign-in.
  private async sendLoginAlert(
    user: { email: string; firstName: string },
    ip: string | undefined,
  ) {
    try {
      await this.mailService.sendAdminLoginAlert(
        user.email,
        user.firstName,
        ip ?? null,
      );
    } catch (error) {
      console.error("BonAgri admin sign-in alert delivery error:", error);
    }
  }

  // ---------- HP3: step-up confirmation (plan G3) ----------

  // Re-proves the password for an already-signed-in user so a dangerous
  // action can proceed. The token is signed with a derived secret (see
  // StepUpGuard) so it can never pass JwtAuthGuard, and it is NOT stored —
  // possession within the 5-minute TTL is the proof.
  async stepUp(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, status: true },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid password");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    const expiresIn = Math.floor(STEP_UP_TTL_MS / 1000);
    const stepUpToken = await this.jwtService.signAsync(
      { sub: user.id, type: "step-up" },
      { secret: this.stepUpSecret(), expiresIn },
    );

    return { stepUpToken, expiresIn };
  }

  // Full step-up validation lives here (mirrors resolveSetupActor for the
  // pre-auth token) so the derived secret exists in exactly one place.
  async verifyStepUpToken(
    token: string | undefined,
  ): Promise<{ id: string } | null> {
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        type?: string;
      }>(token, { secret: this.stepUpSecret() });

      if (payload.type !== "step-up") {
        return null;
      }

      return { id: payload.sub };
    } catch {
      return null;
    }
  }

  private stepUpSecret() {
    const base = process.env.JWT_SECRET ?? "";
    return createHash("sha256").update(`${base}:step-up`).digest("hex");
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Email address has not been verified",
      );
    }

    return user;
  }

  // GET /auth/me — everything the settings screens need in one call: the
  // account row plus whichever role profile applies (both are null for a
  // buyer). The JWT guard stays on the lean validateUser so ordinary
  // requests never pay for the joins.
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        // HP2: /admin/security reads enrolment state from the session
        twoFactorEnabled: true,
        supplierProfile: {
          select: {
            businessName: true,
            description: true,
            registrationNo: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            province: true,
            logoUrl: true,
            verified: true,
          },
        },
        transporterProfile: {
          select: {
            businessName: true,
            vehicleType: true,
            phone: true,
            email: true,
            city: true,
            province: true,
            serviceProvinces: true,
            verified: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }

    return user;
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async issueToken(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: UserRole;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
    emailVerifiedAt: Date | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  }
}
