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
import { RequestsService } from "./requests.service";
import { CreateProductRequestDto } from "./dto/create-product-request.dto";
import { UpdateProductRequestDto } from "./dto/update-product-request.dto";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
  };
};

@Controller("product-requests")
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // Public demand board (CP7): no guard, OPEN requests only, so the
  // landing page can show real demand to anonymous visitors.
  @Get()
  listOpen() {
    return this.requestsService.listOpen();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateProductRequestDto,
  ) {
    return this.requestsService.create(request.user.id, dto);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  getMine(@Req() request: AuthenticatedRequest) {
    return this.requestsService.getMine(request.user.id);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateProductRequestDto,
  ) {
    return this.requestsService.update(id, request.user.id, dto);
  }
}
