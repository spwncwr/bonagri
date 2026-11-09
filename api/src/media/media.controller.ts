import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ThrottlerGuard } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { UserRole } from "../common/types";
import { SignUploadDto } from "./dto/sign-upload.dto";
import { MediaService } from "./media.service";

type AuthenticatedRequest = Request & {
  user: { id: string; role: UserRole };
};

// CP16a: signing endpoint for direct browser → Cloudinary uploads.
@Controller("media")
@UseGuards(ThrottlerGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // Product/branding uploads are vendor work; the "avatar" kind is the one
  // personal image any signed-in account may upload from its settings screen
  // (CP15b delivery photos stay bytea evidence, not Cloudinary). 503 when
  // CLOUDINARY_* is unset.
  @Post("signature")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER", "SUPPLIER", "AGRO_DEALER", "TRANSPORTER", "ADMIN")
  signUpload(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SignUploadDto,
  ) {
    return this.mediaService.signUpload(dto.kind);
  }
}
