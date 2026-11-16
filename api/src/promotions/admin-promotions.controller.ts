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
import { PromotionsService } from "./promotions.service";
import {
  CreatePromoCampaignDto,
  ListAdminCampaignsDto,
  UpdatePromoCampaignDto,
} from "./dto/promotions.dto";

type AuthenticatedRequest = Request & {
  user: { id: string };
};

// Admin-only campaign management. Authorization is enforced server-side by
// JwtAuthGuard + RolesGuard — the web UI's ADMIN guard is convenience only.
// HP3: every mutation additionally requires the step-up confirmation header
// (StepUpGuard) and writes its audit row in the same transaction.
@Controller("admin/promotions")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminPromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get("stats")
  getStats() {
    return this.promotionsService.getStats();
  }

  @Get("options")
  getOptions() {
    return this.promotionsService.getOptions();
  }

  @Get()
  listCampaigns(@Query() query: ListAdminCampaignsDto) {
    return this.promotionsService.listCampaigns(query);
  }

  @Post()
  @UseGuards(StepUpGuard)
  createCampaign(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePromoCampaignDto,
  ) {
    return this.promotionsService.createCampaign(
      dto,
      auditContextFrom(request),
    );
  }

  @Get(":id")
  getCampaign(@Param("id") id: string) {
    return this.promotionsService.getCampaign(id);
  }

  @Get(":id/preview")
  previewCampaign(@Param("id") id: string) {
    return this.promotionsService.previewCampaign(id);
  }

  @Patch(":id")
  @UseGuards(StepUpGuard)
  updateCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdatePromoCampaignDto,
  ) {
    return this.promotionsService.updateCampaign(
      id,
      dto,
      auditContextFrom(request),
    );
  }

  @Post(":id/publish")
  @UseGuards(StepUpGuard)
  publishCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.promotionsService.publishCampaign(
      id,
      auditContextFrom(request),
    );
  }

  @Post(":id/pause")
  @UseGuards(StepUpGuard)
  pauseCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.promotionsService.pauseCampaign(
      id,
      auditContextFrom(request),
    );
  }

  @Post(":id/resume")
  @UseGuards(StepUpGuard)
  resumeCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.promotionsService.resumeCampaign(
      id,
      auditContextFrom(request),
    );
  }

  @Delete(":id")
  @UseGuards(StepUpGuard)
  deleteCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.promotionsService.deleteCampaign(
      id,
      auditContextFrom(request),
    );
  }
}
