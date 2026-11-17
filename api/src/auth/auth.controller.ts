import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { clearRefreshCookie, readRefreshCookie } from "./refresh-cookie";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { EnableTwoFactorDto } from "./dto/enable-two-factor.dto";
import { VerifyTwoFactorDto } from "./dto/verify-two-factor.dto";
import { DisableTwoFactorDto } from "./dto/disable-two-factor.dto";
import { StepUpDto } from "./dto/step-up.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./decorators/roles.decorator";
import { TwoFactorSetupGuard } from "./guards/two-factor-setup.guard";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "TRANSPORTER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

// HP2: setup/enable resolve their actor from EITHER token kind (pre-auth
// during mandatory enrolment, access token when already signed in).
type SetupAuthenticatedRequest = Request & {
  user: { id: string; viaPreAuth: boolean };
};

@Controller("auth")
// CP13: rate limiting. The module default is 120/min; the credential and
// email-sending routes below get stricter budgets. Throttling runs before
// guards, so brute-force attempts are counted even when they fail auth.
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // HP5: the refresh token rides ONLY in the Set-Cookie header (HttpOnly,
  // Path=/api/auth) — strip it from the reply so the JSON body keeps the
  // exact shape callers already parse.
  private withRefreshCookie<T>(res: Response, result: T): T {
    const cookie = (result as { refreshCookie?: string } | null)
      ?.refreshCookie;

    if (typeof cookie === "string") {
      res.setHeader("Set-Cookie", cookie);
      const body = { ...(result as Record<string, unknown>) };
      delete body.refreshCookie;
      return body as T;
    }

    return result;
  }

  @Post("register")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withRefreshCookie(res, await this.authService.login(dto));
  }

  // HP5: cookie-only rotation — the HttpOnly refresh cookie is the only
  // credential accepted here. The reply carries a fresh short-lived access
  // token AND rotates the cookie; replaying a spent cookie revokes the
  // whole family server-side (theft detection).
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withRefreshCookie(
      res,
      await this.authService.refreshSession(
        readRefreshCookie(request.headers.cookie),
      ),
    );
  }

  // HP5: revoke the presented session server-side and clear the cookie, so
  // "log out" is real everywhere — not just a client-side token drop.
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logoutSession(
      readRefreshCookie(request.headers.cookie),
    );
    res.setHeader("Set-Cookie", clearRefreshCookie());
    return result;
  }

  @Get("verify-email")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  verifyEmail(@Query("token") token = "") {
    return this.authService.verifyEmail(token);
  }

  @Post("resend-verification")
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  getMe(@Req() request: AuthenticatedRequest) {
    return this.authService.getMe(request.user.id);
  }

  // ---------- HP2: mandatory admin 2FA ----------

  // Both enrolment routes accept the password-verified pre-auth token OR an
  // access token (see TwoFactorSetupGuard); verify takes the pre-auth token
  // as the Bearer header. Throttling runs before guards, so failed attempts
  // are counted too.
  @Post("2fa/setup")
  @UseGuards(TwoFactorSetupGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  setupTwoFactor(@Req() request: SetupAuthenticatedRequest) {
    return this.authService.setup2fa(request.user);
  }

  @Post("2fa/enable")
  @UseGuards(TwoFactorSetupGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async enableTwoFactor(
    @Req() request: SetupAuthenticatedRequest,
    @Body() dto: EnableTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withRefreshCookie(
      res,
      await this.authService.enable2fa(request.user, dto.code, {
        ip: request.ip,
        rememberMe: dto.rememberMe === true,
      }),
    );
  }

  @Post("2fa/verify")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verifyTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withRefreshCookie(
      res,
      await this.authService.verify2fa(
        request.headers.authorization,
        dto.code,
        {
          ip: request.ip,
          rememberMe: dto.rememberMe === true,
        },
      ),
    );
  }

  @Post("2fa/disable")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  disableTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.authService.disable2fa(request.user.id, dto);
  }

  // ---------- HP3: step-up confirmation (plan G3) ----------

  // Any signed-in user may re-prove their password here; the short-lived
  // token it returns only opens guarded admin mutations (StepUpGuard).
  // Throttled like login — this is a password-guessing surface.
  @Post("step-up")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  stepUp(@Req() request: AuthenticatedRequest, @Body() dto: StepUpDto) {
    return this.authService.stepUp(request.user.id, dto.password);
  }

  // ---------- HP4: password reset (plan G4) ----------

  // Unauthenticated, triggers outbound email, and is a spam/abuse surface —
  // budgeted like resend-verification (5/min). Always 202: the response must
  // be byte-identical whether or not the address exists.
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  // Token guessing surface: only 64-hex tokens that hash to an unexpired,
  // unused row succeed, but brute-force attempts still count against this
  // budget like any other credential probe.
  @Post("reset-password")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
