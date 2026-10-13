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
import { SellerApplicationsService } from "./seller-applications.service";
import { CreateSellerApplicationDto } from "./dto/create-seller-application.dto";
import { ReviewSellerApplicationDto } from "./dto/review-seller-application.dto";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
  };
};

@Controller("seller-applications")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SellerApplicationsController {
  constructor(
    private readonly sellerApplicationsService: SellerApplicationsService,
  ) {}

  @Post()
  @Roles("BUYER")
  apply(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSellerApplicationDto,
  ) {
    return this.sellerApplicationsService.apply(request.user.id, dto);
  }

  @Get("mine")
  @Roles("BUYER")
  getMine(@Req() request: AuthenticatedRequest) {
    return this.sellerApplicationsService.getMine(request.user.id);
  }

  @Get()
  @Roles("ADMIN")
  getQueue() {
    return this.sellerApplicationsService.getQueue();
  }

  @Patch(":id")
  @Roles("ADMIN")
  decide(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewSellerApplicationDto,
  ) {
    return this.sellerApplicationsService.decide(
      id,
      request.user.id,
      dto,
    );
  }
}
