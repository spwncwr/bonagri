import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminAuditActionName, AdminAuditTargetType } from "./actions";
import type { AuditContext } from "./audit-context";

export type AuditEntry = {
  action: AdminAuditActionName;
  targetType: AdminAuditTargetType;
  targetId: string;
  metadata?: Prisma.InputJsonValue | null;
};

export type AuditListQuery = {
  action?: string;
  actor?: string;
  limit?: number;
};

// HP3 (plan G3): the audit trail's only writer. `guarded` runs the mutation
// and its audit row inside ONE transaction — a rolled-back mutation leaves no
// row, and a committed one always has its entry (the gates assert both).
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async guarded<T>(
    context: AuditContext,
    entry: AuditEntry,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await run(tx);

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.actorUserId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: entry.metadata ?? undefined,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
      });

      return result;
    });
  }

  // Recent-activity feed for /admin/audit: newest first, optional action and
  // actor-email filters, plus the distinct actions seen so far (the page's
  // filter dropdown reads them from here — no duplicated list in the web).
  async list(query: AuditListQuery) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actor
        ? { actor: { email: { contains: query.actor, mode: "insensitive" } } }
        : {}),
    };

    const [items, actions] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          ip: true,
          createdAt: true,
          actor: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.adminAuditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);

    return {
      items,
      actions: actions.map((row) => row.action),
    };
  }
}
