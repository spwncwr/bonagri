import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { UserRole } from "../common/types";
import { SendMessageDto } from "./dto/send-message.dto";
import { MessageActor, MessagesService } from "./messages.service";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    role: UserRole;
  };
};

// F2: everyone with a stake in the order may READ the thread; writing is
// the same list minus ADMIN (plan §F2 — admin is read-only; RolesGuard
// answers 403 before the service ever runs).
const READ_ROLES: UserRole[] = [
  "BUYER",
  "SUPPLIER",
  "AGRO_DEALER",
  "TRANSPORTER",
  "ADMIN",
];
const WRITE_ROLES: UserRole[] = [
  "BUYER",
  "SUPPLIER",
  "AGRO_DEALER",
  "TRANSPORTER",
];

const actor = (request: AuthenticatedRequest): MessageActor => ({
  id: request.user.id,
  role: request.user.role,
});

// Thread routes: /api/orders/:orderId/messages
@Controller("orders/:orderId/messages")
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class OrderMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @Roles(...READ_ROLES)
  @UseGuards(RolesGuard)
  list(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.messagesService.listMessages(orderId, actor(request));
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  // Polling reads ride the 120/min default; sends get their own tighter
  // bucket so a single client cannot flood the thread (plan §F2).
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  send(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(orderId, actor(request), dto);
  }

  @Post("read")
  @Roles(...READ_ROLES)
  @UseGuards(RolesGuard)
  // Action, not a creation — the cursor upsert reports state (200), the
  // way login/refresh do (house style: explicit @HttpCode on action POSTs).
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  markRead(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.messagesService.markRead(orderId, actor(request));
  }
}

// Bulk badge feed: /api/messages/unread — one request feeds every order
// card's badge instead of polling each thread separately.
@Controller("messages")
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class MessagesUnreadController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get("unread")
  @Roles(...READ_ROLES)
  @UseGuards(RolesGuard)
  unread(@Req() request: AuthenticatedRequest) {
    return this.messagesService.unreadCounts(actor(request));
  }
}
