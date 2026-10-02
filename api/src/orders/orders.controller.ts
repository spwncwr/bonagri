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
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: "BUYER" | "SUPPLIER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles("BUYER", "ADMIN")
  @UseGuards(RolesGuard)
  getBuyerOrders(@Req() request: AuthenticatedRequest) {
    return this.ordersService.getBuyerOrders(request.user.id);
  }

  @Get("supplier")
  @Roles("SUPPLIER", "ADMIN")
  @UseGuards(RolesGuard)
  getSupplierOrders(@Req() request: AuthenticatedRequest) {
    return this.ordersService.getSupplierOrders(request.user.id);
  }

  @Post()
  @Roles("BUYER")
  @UseGuards(RolesGuard)
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(request.user.id, dto);
  }

  @Patch(":id/status")
  updateOrderStatus(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(
      id,
      request.user.id,
      request.user.role,
      dto,
    );
  }
}
