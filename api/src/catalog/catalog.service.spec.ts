import { NotFoundException } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

function makeService() {
  const prisma = {
    category: { findMany: jest.fn() },
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplierProfile: { findUnique: jest.fn() },
    inventory: { update: jest.fn() },
  };

  return {
    service: new CatalogService(prisma as never),
    prisma,
  };
}

describe("CatalogService (CP1 listings)", () => {
  describe("getProduct (public detail)", () => {
    it("hides DRAFT products from the public", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue({
        id: "prod-1",
        status: "DRAFT",
      });

      await expect(service.getProduct("prod-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("hides INACTIVE products from the public", async () => {
      const { service, prisma } = makeService();

      prisma.product.findUnique.mockResolvedValue({
        id: "prod-1",
        status: "INACTIVE",
      });

      await expect(service.getProduct("prod-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns ACTIVE products", async () => {
      const { service, prisma } = makeService();

      const product = { id: "prod-1", status: "ACTIVE" };
      prisma.product.findUnique.mockResolvedValue(product);

      await expect(service.getProduct("prod-1")).resolves.toBe(product);
    });
  });

  describe("getProducts (public list)", () => {
    it("only ever lists ACTIVE products", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([]);

      await service.getProducts();

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });
  });

  describe("getSupplierProducts", () => {
    it("scopes the list to the authenticated supplier and keeps drafts", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.product.findMany.mockResolvedValue([
        { id: "p1", status: "DRAFT" },
        { id: "p2", status: "ACTIVE" },
      ]);

      const result = await service.getSupplierProducts("supplier-user-1");

      expect(result).toHaveLength(2);
      expect(prisma.supplierProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: "supplier-user-1" },
        select: { id: true },
      });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: "sup-1" },
        }),
      );
    });

    it("rejects a user without a supplier profile", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(service.getSupplierProducts("buyer-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("createProduct / updateProduct ownership", () => {
    it("requires a supplier profile to create a listing", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.createProduct("buyer-1", {} as never),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects updates on products the supplier does not own", async () => {
      const { service, prisma } = makeService();

      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProduct("prod-1", "supplier-user-1", {} as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "prod-1",
            supplier: { userId: "supplier-user-1" },
          }),
        }),
      );
    });
  });
});

describe("CatalogService (CP4 agro dealers)", () => {
  it("lets an AGRO_DEALER create a tool listing under their own profile", async () => {
    const { service, prisma } = makeService();

    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-dealer",
    });
    prisma.product.create.mockResolvedValue({ id: "prod-tool-1" });

    const result = await service.createProduct("dealer-user-1", {
      categoryId: "cat-tools",
      name: "Electric Fence Energizer 12J",
      slug: "electric-fence-energizer-12j",
      sku: "BON-EFE-012",
      price: 1250,
      unit: "each",
      quantity: 25,
      status: "ACTIVE",
    } as never);

    expect(result).toEqual({ id: "prod-tool-1" });
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-dealer",
          unit: "each",
          status: "ACTIVE",
        }),
      }),
    );
  });

  it("scopes an AGRO_DEALER's listing list to their own products", async () => {
    const { service, prisma } = makeService();

    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-dealer",
    });
    prisma.product.findMany.mockResolvedValue([]);

    await service.getSupplierProducts("dealer-user-1");

    expect(prisma.supplierProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "dealer-user-1" } }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: "sup-dealer" },
      }),
    );
  });

  it("rejects an AGRO_DEALER updating another vendor's listing (404)", async () => {
    const { service, prisma } = makeService();

    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.updateProduct("prod-supplier-1", "dealer-user-1", {
        price: 1,
      } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "prod-supplier-1",
          supplier: { userId: "dealer-user-1" },
        }),
      }),
    );
  });
});
