import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { UserRole } from "../common/types";
import { DisputesService } from "./disputes.service";
import { OpenDisputeDto } from "./dto/open-dispute.dto";
import { ResolveDisputeDto } from "./dto/resolve-dispute.dto";

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

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post("orders/:id/dispute")
  @Roles("BUYER")
  openDispute(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.disputesService.openDispute(
      id,
      request.user.id,
      request.user.role,
      dto,
    );
  }

  // Vendor side: disputes raised on orders containing this vendor's products.
  @Get("disputes/mine")
  @Roles("SUPPLIER", "AGRO_DEALER")
  getVendorDisputes(@Req() request: AuthenticatedRequest) {
    return this.disputesService.getVendorDisputes(request.user.id);
  }

  @Get("disputes")
  @Roles("ADMIN")
  getAdminDisputes() {
    return this.disputesService.getAdminDisputes();
  }

  @Patch("disputes/:id")
  @Roles("ADMIN")
  resolveDispute(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputesService.resolveDispute(
      id,
      request.user.id,
      dto,
    );
  }
}
