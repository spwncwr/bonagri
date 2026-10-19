import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { UserRole } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { TransportService } from "./transport.service";

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

@Controller("transport")
@UseGuards(JwtAuthGuard)
export class TransportController {
  constructor(
    private readonly transportService: TransportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("jobs")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  getJobs(@Req() request: AuthenticatedRequest) {
    return this.transportService.getJobs(request.user.id);
  }

  @Post("jobs/:orderId/claim")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  claimJob(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    return this.transportService.claimJob(orderId, request.user.id);
  }

  @Get("deliveries")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  getMyDeliveries(@Req() request: AuthenticatedRequest) {
    return this.transportService.getMyDeliveries(request.user.id);
  }

  // Verified-transporter directory for the supplier's re-dispatch
  // dropdown. Read-only summary — no contacts.
  @Get("transporters")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  listVerifiedTransporters() {
    return this.prisma.transporterProfile.findMany({
      where: { verified: true },
      select: {
        id: true,
        businessName: true,
        vehicleType: true,
        city: true,
        province: true,
        serviceProvinces: true,
        verified: true,
      },
      orderBy: { businessName: "asc" },
      take: 100,
    });
  }
}
