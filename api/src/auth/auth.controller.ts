import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

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

@Controller("auth")
// CP13: rate limiting. The module default is 120/min; the credential and
// email-sending routes below get stricter budgets. Throttling runs before
// guards, so brute-force attempts are counted even when they fail auth.
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
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
    return request.user;
  }
}
