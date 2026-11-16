import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { StepUpGuard } from "../auth/guards/step-up.guard";
import { auditContextFrom } from "../audit/audit-context";
import { AdminService } from "./admin.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { PromoteSupplierDto } from "./dto/promote-supplier.dto";
import { PromoteTransporterDto } from "./dto/promote-transporter.dto";
import { UpdateSupplierVerifyDto } from "./dto/update-supplier-verify.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { BroadcastNotificationDto } from "./dto/broadcast-notification.dto";
import { CreateBannerDto } from "./dto/create-banner.dto";
import { UpdateBannerDto } from "./dto/update-banner.dto";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    role: string;
  };
};

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  getStats() {
    return this.adminService.getStats();
  }

  @Get("users")
  getUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  // HP3: everything below is a guarded mutation — StepUpGuard demands a
  // fresh password confirmation, and AdminService writes the audit row in
  // the same transaction as the change (plan G3).
  @Patch("users/:id/status")
  @UseGuards(StepUpGuard)
  updateUserStatus(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Post("users/:id/promote-supplier")
  @UseGuards(StepUpGuard)
  promoteToSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: PromoteSupplierDto,
  ) {
    return this.adminService.promoteToSupplier(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  // CP14: transporter management (promote, list, verify toggle).
  @Post("users/:id/promote-transporter")
  @UseGuards(StepUpGuard)
  promoteToTransporter(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: PromoteTransporterDto,
  ) {
    return this.adminService.promoteToTransporter(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Get("transporters")
  getTransporters(@Query("verified") verified?: string) {
    return this.adminService.listTransporters(
      verified === undefined ? undefined : verified === "true",
    );
  }

  @Patch("transporters/:id")
  @UseGuards(StepUpGuard)
  setTransporterVerified(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateSupplierVerifyDto,
  ) {
    return this.adminService.setTransporterVerified(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Get("suppliers")
  getSupplierProfiles() {
    return this.adminService.getSupplierProfiles();
  }

  @Patch("suppliers/:id")
  @UseGuards(StepUpGuard)
  setSupplierVerified(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateSupplierVerifyDto,
  ) {
    return this.adminService.setSupplierVerified(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Post("categories")
  @UseGuards(StepUpGuard)
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.adminService.createCategory(dto, auditContextFrom(request));
  }

  @Patch("categories/:id")
  @UseGuards(StepUpGuard)
  updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminService.updateCategory(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  // Broadcast notifications
  @Get("notifications/audience-counts")
  getAudienceCounts() {
    return this.adminService.getAudienceCounts();
  }

  @Get("notifications/broadcasts")
  listBroadcasts() {
    return this.adminService.listBroadcasts();
  }

  @Post("notifications/broadcast")
  @UseGuards(StepUpGuard)
  broadcastNotification(
    @Req() request: AuthenticatedRequest,
    @Body() dto: BroadcastNotificationDto,
  ) {
    return this.adminService.broadcastNotification(
      dto,
      auditContextFrom(request),
    );
  }

  // Promo Banners
  @Get("banners")
  getBanners() {
    return this.adminService.listBanners();
  }

  @Post("banners")
  @UseGuards(StepUpGuard)
  createBanner(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBannerDto,
  ) {
    return this.adminService.createBanner(dto, auditContextFrom(request));
  }

  @Patch("banners/:id")
  @UseGuards(StepUpGuard)
  updateBanner(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateBannerDto,
  ) {
    return this.adminService.updateBanner(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Delete("banners/:id")
  @UseGuards(StepUpGuard)
  deleteBanner(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.adminService.deleteBanner(id, auditContextFrom(request));
  }
}
