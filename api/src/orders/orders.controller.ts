import {
  Body,
  Controller,
  Delete,
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
import { FailDeliveryDto } from "./dto/fail-delivery.dto";
import { RecordPaymentDto } from "./dto/record-payment.dto";
import { RedispatchDeliveryDto } from "./dto/redispatch-delivery.dto";
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

  @Get(":id/delivery")
  getDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.getDelivery(
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

  // CP14: delivery-job lifecycle. Publish/unpublish/re-dispatch belong to
  // the owning supplier (or admin); the pickup/transit/complete/fail
  // actions belong to the transporter who claimed the job.
  @Post(":id/delivery/publish")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  publishDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.publishDelivery(
      id,
      request.user.id,
      request.user.role,
    );
  }

  @Delete(":id/delivery/publish")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  unpublishDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.unpublishDelivery(
      id,
      request.user.id,
      request.user.role,
    );
  }

  @Post(":id/delivery/re-dispatch")
  @Roles("SUPPLIER", "AGRO_DEALER", "ADMIN")
  @UseGuards(RolesGuard)
  redispatchDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RedispatchDeliveryDto,
  ) {
    return this.ordersService.redispatchDelivery(
      id,
      request.user.id,
      request.user.role,
      dto,
    );
  }

  @Patch(":id/delivery/pickup")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  pickupDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.deliveryAction(
      id,
      request.user.id,
      "pickup",
    );
  }

  @Patch(":id/delivery/transit")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  transitDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.deliveryAction(
      id,
      request.user.id,
      "transit",
    );
  }

  @Patch(":id/delivery/complete")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  completeDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.ordersService.deliveryAction(
      id,
      request.user.id,
      "complete",
    );
  }

  @Patch(":id/delivery/fail")
  @Roles("TRANSPORTER")
  @UseGuards(RolesGuard)
  failDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: FailDeliveryDto,
  ) {
    return this.ordersService.deliveryAction(
      id,
      request.user.id,
      "fail",
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
