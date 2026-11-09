import { Body, Controller, Patch, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserRole } from "../common/types";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ProfileService } from "./profile.service";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: UserRole;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

// The signed-in account's own settings. No @Roles: buyers, suppliers, agro
// dealers, transporters and admins all edit the same row.
@Controller("profile")
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Patch("me")
  updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(request.user.id, dto);
  }
}
