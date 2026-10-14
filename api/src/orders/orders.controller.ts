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
import { CreateOrderDto } from "./dto/create-order.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { OrdersService } from "./orders.service";

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

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles("BUYER", "ADMIN")
  @UseGuards(RolesGuard)
  getBuyerOrders(@Req() request: AuthenticatedRequest) {
    return this.ordersService.getBuyerOrders(
      request.user.id,
      request.user.role,
    );
  }

  @Get("supplier")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  getSupplierOrders(@Req() request: AuthenticatedRequest) {
    return this.ordersService.getSupplierOrders(
      request.user.id,
      request.user.role,
    );
  }

  @Get(":id")
  getOrder(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.getOrderDetail(
      id,
      request.user.id,
      request.user.role,
    );
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

  @Post(":id/payment")
  @Roles("BUYER")
  @UseGuards(RolesGuard)
  recordPayment(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.ordersService.recordPayment(id, request.user.id, dto);
  }

  @Patch(":id/payment")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  updatePayment(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.ordersService.updatePayment(
      id,
      request.user.id,
      request.user.role,
      dto,
    );
  }
}
