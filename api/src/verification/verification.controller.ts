import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { UserRole } from "../common/types";
import { ConfirmPhoneOtpDto } from "./dto/confirm-phone-otp.dto";
import { SendPhoneOtpDto } from "./dto/send-phone-otp.dto";
import { SubmitVerificationApplicationDto } from "./dto/submit-application.dto";
import { VerificationService } from "./verification.service";

type AuthenticatedRequest = Request & {
  user: { id: string; role: UserRole };
};

const ALL_ROLES: UserRole[] = [
  "BUYER",
  "SUPPLIER",
  "AGRO_DEALER",
  "TRANSPORTER",
  "ADMIN",
];

// CP17: applicant-facing verification endpoints. Status changes to VERIFIED
// (or any other administrative state) are NOT reachable from here — see
// AdminVerificationController for the only privileged path.
@Controller("verification")
@UseGuards(ThrottlerGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  // Safe summary: phone state, business status, latest application,
  // document requirements. Never exposes documents or internal notes.
  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  getMe(@Req() request: AuthenticatedRequest) {
    return this.verification.getMe(request.user.id);
  }

  // Buyer phone OTP. The 6-digit code is emailed to the account's verified
  // address — that is the trusted channel in this stack (no SMS provider).
  // 5/min here, plus a per-user 60s cooldown inside the service.
  @Post("phone/send")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  sendPhoneOtp(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SendPhoneOtpDto,
  ) {
    return this.verification.sendPhoneOtp(request.user.id, dto.phone);
  }

  @Post("phone/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  confirmPhoneOtp(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ConfirmPhoneOtpDto,
  ) {
    return this.verification.confirmPhoneOtp(request.user.id, dto.code);
  }

  // First business application (or a fresh one after a rejection).
  @Post("applications")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "AGRO_DEALER")
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  submitApplication(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SubmitVerificationApplicationDto,
  ) {
    return this.verification.submitApplication(request.user.id, dto);
  }

  // Corrections-only: the application an admin put into ACTION_REQUIRED
  // goes back to PENDING without losing the previous decision.
  @Post("applications/:id/resubmit")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "AGRO_DEALER")
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resubmitApplication(
    @Req() request: AuthenticatedRequest,
    @Param("id") applicationId: string,
    @Body() dto: SubmitVerificationApplicationDto,
  ) {
    return this.verification.resubmitApplication(
      request.user.id,
      applicationId,
      dto,
    );
  }

  @Get("applications/mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "AGRO_DEALER")
  listMine(@Req() request: AuthenticatedRequest) {
    return this.verification.listMine(request.user.id);
  }

  // Private document access: owner or admin only, answered with a signed
  // Cloudinary URL (never a permanent public link).
  @Get("applications/:id/documents/:documentId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  getDocumentUrl(
    @Req() request: AuthenticatedRequest,
    @Param("id") applicationId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.verification.getDocumentUrl(
      request.user,
      applicationId,
      documentId,
    );
  }
}
