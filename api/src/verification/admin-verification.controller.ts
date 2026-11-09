import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AdminVerificationActionDto } from "./dto/admin-action.dto";
import { AdminVerificationQueryDto } from "./dto/admin-query.dto";
import { VerificationService } from "./verification.service";

type AdminRequest = Request & {
  user: { id: string; role: string };
};

// CP17: the ONLY path that changes verification status. Guarded twice
// (JWT + ADMIN role) and every transition is validated inside the service —
// a client calling these routes manually still cannot approve itself.
@Controller("admin/verification")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get("stats")
  getStats() {
    return this.verification.adminStats();
  }

  // Paginated queue: status / role / free-text (business name, email, ids)
  // / submission-date filters.
  @Get("applications")
  listApplications(@Query() query: AdminVerificationQueryDto) {
    return this.verification.adminList(query);
  }

  // Full detail including documents metadata and the audit trail. Document
  // bytes stay behind GET /verification/applications/:id/documents/:docId.
  @Get("applications/:id")
  getApplication(@Param("id") id: string) {
    return this.verification.adminGet(id);
  }

  // start_review | approve | reject | request_info | suspend
  @Post("applications/:id/actions")
  act(
    @Req() request: AdminRequest,
    @Param("id") id: string,
    @Body() dto: AdminVerificationActionDto,
  ) {
    return this.verification.adminAct(id, request.user.id, dto);
  }
}
