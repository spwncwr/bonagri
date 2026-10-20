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
    supplierProfile: { findUnique: jest.fn(), update: jest.fn() },
    inventory: { update: jest.fn() },
  };

  // CP16a: Cloudinary interaction is mocked — derive is pure URL parsing,
  // destroy is best-effort.
  const media = {
    derivePublicId: jest.fn().mockReturnValue(null),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new CatalogService(prisma as never, media as never),
    prisma,
    media,
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

describe("CatalogService (CP15a reference pins)", () => {
  describe("updateSupplierPin", () => {
    it("stores the farm pin on the caller's own profile", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.supplierProfile.update.mockResolvedValue({
        id: "sup-1",
        businessName: "Test Farm",
        lat: -23.88,
        lng: 29.45,
      });

      const result = await service.updateSupplierPin("supplier-user-1", {
        lat: -23.88,
        lng: 29.45,
      });

      expect(prisma.supplierProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: "supplier-user-1" },
        select: { id: true },
      });
      expect(prisma.supplierProfile.update).toHaveBeenCalledWith({
        where: { id: "sup-1" },
        data: { lat: -23.88, lng: 29.45 },
        select: { id: true, businessName: true, lat: true, lng: true },
      });
      expect(result).toBeDefined();
    });

    it("404s when the account has no supplier profile", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSupplierPin("buyer-user-1", { lat: 1, lng: 2 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe("CatalogService (CP16a media foundation)", () => {
  describe("createProduct image handling", () => {
    it("derives the managed public_id from our own Cloudinary URL", async () => {
      const { service, prisma, media } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      media.derivePublicId.mockReturnValue("bonagri/product/uuid-1");
      prisma.product.create.mockResolvedValue({ id: "prod-1" });

      await service.createProduct("supplier-user-1", {
        categoryId: "cat-1",
        name: "Tomatoes 1kg",
        slug: "tomatoes-1kg",
        sku: "BON-TOM-1",
        price: 25,
        unit: "kg",
        imageUrl:
          "https://res.cloudinary.com/demo/image/upload/v123/bonagri/product/uuid-1.jpg",
      } as never);

      expect(media.derivePublicId).toHaveBeenCalledWith(
        "https://res.cloudinary.com/demo/image/upload/v123/bonagri/product/uuid-1.jpg",
      );
      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            imageUrl:
              "https://res.cloudinary.com/demo/image/upload/v123/bonagri/product/uuid-1.jpg",
            imagePublicId: "bonagri/product/uuid-1",
          }),
        }),
      );
    });

    it("stores no public_id for external URLs (nothing to destroy later)", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.product.create.mockResolvedValue({ id: "prod-1" });

      await service.createProduct("supplier-user-1", {
        categoryId: "cat-1",
        name: "Tomatoes 1kg",
        slug: "tomatoes-1kg",
        sku: "BON-TOM-1",
        price: 25,
        unit: "kg",
        imageUrl: "https://cdn.examplefarm.co.za/tomatoes.jpg",
      } as never);

      expect(prisma.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ imagePublicId: null }),
        }),
      );
    });
  });

  describe("updateProduct image replace/clear (CP16a)", () => {
    it("destroys the old managed asset when the image URL changes", async () => {
      const { service, prisma, media } = makeService();
      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: "bonagri/product/old",
      });
      media.derivePublicId.mockReturnValue("bonagri/product/new");
      prisma.product.update.mockResolvedValue({ id: "prod-1" });

      await service.updateProduct("prod-1", "supplier-user-1", {
        imageUrl:
          "https://res.cloudinary.com/demo/image/upload/v999/bonagri/product/new.jpg",
      } as never);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            imagePublicId: "bonagri/product/new",
          }),
        }),
      );
      expect(media.destroyAsset).toHaveBeenCalledWith("bonagri/product/old");
    });

    it("keeps the asset when the URL is unchanged", async () => {
      const { service, prisma, media } = makeService();
      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: "bonagri/product/same",
      });
      media.derivePublicId.mockReturnValue("bonagri/product/same");
      prisma.product.update.mockResolvedValue({ id: "prod-1" });

      await service.updateProduct("prod-1", "supplier-user-1", {
        imageUrl:
          "https://res.cloudinary.com/demo/image/upload/v1/bonagri/product/same.jpg",
      } as never);

      expect(media.destroyAsset).not.toHaveBeenCalled();
    });

    it("clears image + public_id on null and destroys the asset", async () => {
      const { service, prisma, media } = makeService();
      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: "bonagri/product/old",
      });
      prisma.product.update.mockResolvedValue({ id: "prod-1" });

      await service.updateProduct("prod-1", "supplier-user-1", {
        imageUrl: null,
      });

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            imageUrl: null,
            imagePublicId: null,
          }),
        }),
      );
      expect(media.destroyAsset).toHaveBeenCalledWith("bonagri/product/old");
    });

    it("leaves image fields untouched when imageUrl is omitted", async () => {
      const { service, prisma, media } = makeService();
      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: "bonagri/product/kept",
      });
      prisma.product.update.mockResolvedValue({ id: "prod-1" });

      await service.updateProduct("prod-1", "supplier-user-1", {
        name: "Renamed only",
      } as never);

      const data = prisma.product.update.mock.calls[0][0].data;
      expect("imagePublicId" in data).toBe(false);
      expect(media.destroyAsset).not.toHaveBeenCalled();
    });
  });

  describe("updateSupplierProfile (CP16a logo)", () => {
    it("sets the logo and derives its public_id", async () => {
      const { service, prisma, media } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: null,
      });
      media.derivePublicId.mockReturnValue("bonagri/supplier_logo/uuid-9");
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", {
        logoUrl:
          "https://res.cloudinary.com/demo/image/upload/v5/bonagri/supplier_logo/uuid-9.png",
      });

      expect(prisma.supplierProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sup-1" },
          data: {
            logoUrl:
              "https://res.cloudinary.com/demo/image/upload/v5/bonagri/supplier_logo/uuid-9.png",
            logoPublicId: "bonagri/supplier_logo/uuid-9",
          },
        }),
      );
      expect(media.destroyAsset).not.toHaveBeenCalled();
    });

    it("replacing the logo destroys the previous managed asset", async () => {
      const { service, prisma, media } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: "bonagri/supplier_logo/old",
      });
      media.derivePublicId.mockReturnValue("bonagri/supplier_logo/new");
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", {
        logoUrl:
          "https://res.cloudinary.com/demo/image/upload/v6/bonagri/supplier_logo/new.png",
      });

      expect(media.destroyAsset).toHaveBeenCalledWith(
        "bonagri/supplier_logo/old",
      );
    });

    it("clearing the logo on null destroys the managed asset", async () => {
      const { service, prisma, media } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: "bonagri/supplier_logo/old",
      });
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", { logoUrl: null });

      expect(prisma.supplierProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { logoUrl: null, logoPublicId: null },
        }),
      );
      expect(media.destroyAsset).toHaveBeenCalledWith(
        "bonagri/supplier_logo/old",
      );
    });

    it("404s when the account has no supplier profile", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSupplierProfile("buyer-user-1", { logoUrl: null }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
