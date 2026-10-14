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
import { CreateRequestResponseDto } from "./dto/create-request-response.dto";
import { UpdateRequestResponseDto } from "./dto/update-request-response.dto";

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

  @Get("responses/mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "AGRO_DEALER")
  getMyResponses(@Req() request: AuthenticatedRequest) {
    return this.requestsService.listMyResponses(request.user.id);
  }

  @Get(":id/responses")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  listResponses(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.requestsService.listResponses(id, request.user.id);
  }

  @Post(":id/responses")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "AGRO_DEALER")
  respond(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CreateRequestResponseDto,
  ) {
    return this.requestsService.respond(id, request.user.id, dto);
  }

  @Patch("responses/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER", "SUPPLIER", "AGRO_DEALER")
  updateResponse(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateRequestResponseDto,
  ) {
    return this.requestsService.updateResponse(id, request.user.id, dto);
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
