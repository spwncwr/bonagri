import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AdminAuditService } from "./admin-audit.service";
import type { AuditListQuery } from "./admin-audit.service";

// HP3: the admin activity feed (read side of the trail). Writes happen in the
// guarded mutation services — this controller only reads.
@Controller("admin/audit")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  @Get()
  list(
    @Query()
    query: AuditListQuery & { limit?: string },
  ) {
    return this.auditService.list({
      action: query.action || undefined,
      actor: query.actor || undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }
}
