import { AdminAuditService } from "./admin-audit.service";

// HP3: the /admin/audit feed's read side — filters, clamping and the
// distinct-action list the page's filter dropdown reads from the response.
// The write side (guarded) is covered in admin.service.spec.ts.
function makeService() {
  const prisma = {
    adminAuditLog: {
      findMany: jest.fn(),
    },
  };

  return { service: new AdminAuditService(prisma as never), prisma };
}

describe("AdminAuditService.list", () => {
  it("returns newest-first items plus the distinct actions", async () => {
    const { service, prisma } = makeService();
    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([
        { id: "log-1", action: "PROMOTION_PUBLISH" },
      ])
      .mockResolvedValueOnce([
        { action: "BANNER_CREATE" },
        { action: "PROMOTION_PUBLISH" },
      ]);

    const result = await service.list({});

    expect(result.items).toHaveLength(1);
    expect(result.actions).toEqual(["BANNER_CREATE", "PROMOTION_PUBLISH"]);
    expect(prisma.adminAuditLog.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  });

  it("applies the action and actor-email filters", async () => {
    const { service, prisma } = makeService();
    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.list({ action: "PROMOTION_PUBLISH", actor: "admin@" });

    expect(prisma.adminAuditLog.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          action: "PROMOTION_PUBLISH",
          actor: {
            email: { contains: "admin@", mode: "insensitive" },
          },
        },
      }),
    );
  });

  it("clamps the limit into [1, 200]", async () => {
    const { service, prisma } = makeService();
    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.list({ limit: 5000 });
    expect(prisma.adminAuditLog.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 200 }),
    );

    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.list({ limit: 0 });
    expect(prisma.adminAuditLog.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ take: 1 }),
    );
  });
});
