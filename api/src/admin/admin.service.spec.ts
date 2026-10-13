import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { AdminService } from "./admin.service";

function makeService() {
  const tx = {
    supplierProfile: { create: jest.fn() },
    user: { update: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) =>
      callback(tx),
    ),
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    supplierProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    product: { groupBy: jest.fn() },
    order: { groupBy: jest.fn(), aggregate: jest.fn() },
    category: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };

  return {
    service: new AdminService(prisma as never),
    prisma,
    tx,
  };
}

const summarySelect = expect.objectContaining({
  supplierProfile: expect.any(Object),
});

describe("AdminService (CP3 management)", () => {
  describe("promoteToSupplier", () => {
    it("creates the supplier profile and promotes the role in one transaction", async () => {
      const { service, prisma, tx } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "thandi@example.com",
        role: "BUYER",
        supplierProfile: null,
      });
      tx.supplierProfile.create.mockResolvedValue({ id: "sup-1" });
      tx.user.update.mockResolvedValue({
        id: "user-1",
        role: "SUPPLIER",
        supplierProfile: { id: "sup-1" },
      });

      const result = await service.promoteToSupplier("user-1", {
        businessName: "Thandi Fresh Produce",
        city: "Tzaneen",
      });

      expect(result.role).toBe("SUPPLIER");
      expect(tx.supplierProfile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          businessName: "Thandi Fresh Produce",
          email: "thandi@example.com",
          verified: false,
        }),
      });
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: { role: "SUPPLIER" },
        }),
      );
    });

    it("never creates a second profile (promote twice -> conflict)", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "thandi@example.com",
        role: "SUPPLIER",
        supplierProfile: { id: "sup-1" },
      });

      await expect(
        service.promoteToSupplier("user-1", {
          businessName: "Again",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("maps a concurrent duplicate-profile race to a conflict", async () => {
      const { service, prisma, tx } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "thandi@example.com",
        role: "BUYER",
        supplierProfile: null,
      });
      tx.supplierProfile.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );

      await expect(
        service.promoteToSupplier("user-1", { businessName: "X" }),
      ).rejects.toThrow(ConflictException);
    });

    it("refuses to promote an admin account", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "admin-1",
        email: "admin@example.com",
        role: "ADMIN",
        supplierProfile: null,
      });

      await expect(
        service.promoteToSupplier("admin-1", { businessName: "X" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("404s for a missing user", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.promoteToSupplier("ghost", { businessName: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateUserStatus", () => {
    it("suspends a user", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        role: "BUYER",
        status: "ACTIVE",
      });
      prisma.user.update.mockResolvedValue({
        id: "user-1",
        role: "BUYER",
        status: "SUSPENDED",
      });

      const result = await service.updateUserStatus("user-1", {
        status: "SUSPENDED",
      });

      expect(result.status).toBe("SUSPENDED");
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: { status: "SUSPENDED" },
          select: summarySelect,
        }),
      );
    });

    it("refuses to suspend an admin account", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "admin-1",
        role: "ADMIN",
        status: "ACTIVE",
      });

      await expect(
        service.updateUserStatus("admin-1", { status: "SUSPENDED" }),
      ).rejects.toThrow("Admin accounts cannot be suspended");
    });

    it("reactivates a suspended user", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        role: "SUPPLIER",
        status: "SUSPENDED",
      });
      prisma.user.update.mockResolvedValue({
        id: "user-1",
        role: "SUPPLIER",
        status: "ACTIVE",
      });

      const result = await service.updateUserStatus("user-1", {
        status: "ACTIVE",
      });

      expect(result.status).toBe("ACTIVE");
    });

    it("404s for a missing user", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateUserStatus("ghost", { status: "SUSPENDED" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("setSupplierVerified", () => {
    it("toggles the verified flag", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.supplierProfile.update.mockResolvedValue({
        id: "sup-1",
        verified: true,
      });

      const result = await service.setSupplierVerified("sup-1", {
        verified: true,
      });

      expect(result.verified).toBe(true);
      expect(prisma.supplierProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sup-1" },
          data: { verified: true },
        }),
      );
    });

    it("404s for a missing profile", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.setSupplierVerified("ghost", { verified: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("categories", () => {
    it("auto-generates the slug from the name", async () => {
      const { service, prisma } = makeService();

      prisma.category.create.mockResolvedValue({ id: "cat-1" });

      await service.createCategory({ name: "Fresh Poultry & Eggs" });

      expect(prisma.category.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Fresh Poultry & Eggs",
          slug: "fresh-poultry-eggs",
        }),
      });
    });

    it("maps a duplicate name/slug to a conflict", async () => {
      const { service, prisma } = makeService();

      prisma.category.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint"), { code: "P2002" }),
      );

      await expect(
        service.createCategory({ name: "Vegetables" }),
      ).rejects.toThrow(ConflictException);
    });

    it("renames an existing category", async () => {
      const { service, prisma } = makeService();

      prisma.category.findUnique.mockResolvedValue({ id: "cat-1" });
      prisma.category.update.mockResolvedValue({
        id: "cat-1",
        name: "Grains & Cereals",
      });

      const result = await service.updateCategory("cat-1", {
        name: "Grains & Cereals",
      });

      expect(result.name).toBe("Grains & Cereals");
      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1" },
          data: { name: "Grains & Cereals" },
        }),
      );
    });

    it("404s for a missing category", async () => {
      const { service, prisma } = makeService();

      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCategory("ghost", { name: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getUsers", () => {
    it("applies role/status/search filters", async () => {
      const { service, prisma } = makeService();

      prisma.user.findMany.mockResolvedValue([]);

      await service.getUsers({
        role: "SUPPLIER",
        status: "ACTIVE",
        search: "thandi",
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: "SUPPLIER",
            status: "ACTIVE",
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe("getStats", () => {
    it("aggregates users, products, orders and revenue", async () => {
      const { service, prisma } = makeService();

      prisma.user.groupBy.mockResolvedValue([
        { role: "BUYER", _count: { _all: 3 } },
        { role: "SUPPLIER", _count: { _all: 1 } },
      ]);
      prisma.user.count.mockResolvedValue(1);
      prisma.product.groupBy.mockResolvedValue([
        { status: "ACTIVE", _count: { _all: 5 } },
      ]);
      prisma.order.groupBy.mockResolvedValue([
        { status: "DELIVERED", _count: { _all: 2 } },
      ]);
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 100 } })
        .mockResolvedValueOnce({ _sum: { total: 120 } });

      const stats = await service.getStats();

      expect(stats.users.total).toBe(4);
      expect(stats.users.buyers).toBe(3);
      expect(stats.users.suspended).toBe(1);
      expect(stats.products.active).toBe(5);
      expect(stats.orders.delivered).toBe(2);
      expect(stats.revenue.net).toBe(100);
      expect(stats.revenue.gross).toBe(120);
    });
  });
});
