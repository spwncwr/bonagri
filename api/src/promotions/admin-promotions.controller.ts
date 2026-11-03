import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PromotionsService } from "./promotions.service";
import {
  CreatePromoCampaignDto,
  ListAdminCampaignsDto,
  UpdatePromoCampaignDto,
} from "./dto/promotions.dto";

// Admin-only campaign management. Authorization is enforced server-side by
// JwtAuthGuard + RolesGuard — the web UI's ADMIN guard is convenience only.
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
  createCampaign(@Body() dto: CreatePromoCampaignDto) {
    return this.promotionsService.createCampaign(dto);
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
  updateCampaign(
    @Param("id") id: string,
    @Body() dto: UpdatePromoCampaignDto,
  ) {
    return this.promotionsService.updateCampaign(id, dto);
  }

  @Post(":id/publish")
  publishCampaign(@Param("id") id: string) {
    return this.promotionsService.publishCampaign(id);
  }

  @Post(":id/pause")
  pauseCampaign(@Param("id") id: string) {
    return this.promotionsService.pauseCampaign(id);
  }

  @Post(":id/resume")
  resumeCampaign(@Param("id") id: string) {
    return this.promotionsService.resumeCampaign(id);
  }

  @Delete(":id")
  deleteCampaign(@Param("id") id: string) {
    return this.promotionsService.deleteCampaign(id);
  }
}
