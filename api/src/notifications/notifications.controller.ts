import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
  };
};

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getMyNotifications(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.getMyNotifications(request.user.id);
  }

  @Patch(":id/read")
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.notificationsService.markRead(id, request.user.id);
  }
}
