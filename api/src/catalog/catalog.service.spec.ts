import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { CatalogService } from "./catalog.service";

function makeService() {
  const prisma = {
    // findUnique defaults to "this category exists" — the unknown-category
    // guard test overrides it with mockResolvedValue(null).
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(
        ({ where }: { where?: { id?: string } }) =>
          Promise.resolve(where?.id ? { id: where.id } : null),
      ),
    },
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    supplierProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    inventory: { update: jest.fn() },
  };

  // CP16a: Cloudinary interaction is mocked — derive is pure URL parsing,
  // destroy is best-effort.
  const media = {
    derivePublicId: jest.fn().mockReturnValue(null),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
  };

  // CP17: rating summaries are delegated to ReviewsService — passthrough mock
  // so the existing payload assertions keep comparing the same objects.
  const reviews = {
    attachSummaries: jest.fn(
      (products: unknown) => Promise.resolve(products),
    ),
  };

  return {
    service: new CatalogService(
      prisma as never,
      media as never,
      reviews as never,
    ),
    prisma,
    media,
    reviews,
  };
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Fresh Tomatoes",
    sku: "SKU-1",
    price: "20.00",
    description: null,
    status: "ACTIVE",
    createdAt: new Date("2026-01-01"),
    category: { name: "Vegetables" },
    supplier: { businessName: "BonAgri Farm" },
    inventory: { quantity: 1, reservedQuantity: 0 },
    ...overrides,
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

    it("attaches CP17 rating summaries to every listed product", async () => {
      const { service, prisma, reviews } = makeService();

      const products = [makeProduct({ id: "p1" }), makeProduct({ id: "p2" })];
      prisma.product.findMany.mockResolvedValue(products);

      await service.getProducts();

      expect(reviews.attachSummaries).toHaveBeenCalledWith(products);
    });

    it("searches names, skus, descriptions, categories and suppliers", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([]);

      await service.getProducts({ search: "tomato" });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
            OR: expect.arrayContaining([
              { name: { contains: "tomato", mode: "insensitive" } },
              { sku: { contains: "tomato", mode: "insensitive" } },
              { description: { contains: "tomato", mode: "insensitive" } },
              {
                category: {
                  name: { contains: "tomato", mode: "insensitive" },
                },
              },
              {
                supplier: {
                  businessName: { contains: "tomato", mode: "insensitive" },
                },
              },
            ]),
          }),
        }),
      );
    });

    it("ranks exact and prefix name matches above description matches", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([
        makeProduct({ id: "p1", name: "Fresh Tomatoes" }),
        makeProduct({ id: "p2", name: "Tomato" }),
        makeProduct({ id: "p3", name: "Tomatoes" }),
        makeProduct({ id: "p4", name: "Chilli Sauce" }),
      ]);

      const result = await service.getProducts({ search: "tomato" });

      expect(result.map((product) => product.id)).toEqual([
        "p2",
        "p3",
        "p1",
        "p4",
      ]);
    });

    it("filters by category slug, price range, seller and location", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([]);

      await service.getProducts({
        category: "fruits",
        minPrice: 10,
        maxPrice: 50,
        supplierId: "sup-1",
        province: "Limpopo",
        city: "Tzaneen",
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "ACTIVE",
            category: { slug: "fruits" },
            price: { gte: 10, lte: 50 },
            supplierId: "sup-1",
            supplier: {
              province: { equals: "Limpopo", mode: "insensitive" },
              city: { equals: "Tzaneen", mode: "insensitive" },
            },
          }),
        }),
      );
    });

    it("rejects a minimum price above the maximum", async () => {
      const { service, prisma } = makeService();

      await expect(
        service.getProducts({ minPrice: 100, maxPrice: 10 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it("hides out-of-stock products from the marketplace by default", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([
        makeProduct({
          id: "available",
          inventory: { quantity: 5, reservedQuantity: 2 },
        }),
        makeProduct({
          id: "reserved",
          inventory: { quantity: 2, reservedQuantity: 2 },
        }),
        makeProduct({ id: "missing", inventory: null }),
      ]);

      const result = await service.getProducts();

      expect(result.map((product) => product.id)).toEqual(["available"]);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inventory: { is: { quantity: { gt: 0 } } },
          }),
        }),
      );
    });

    it("keeps out-of-stock rows only when inStock is explicitly false", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([
        makeProduct({
          id: "available",
          inventory: { quantity: 5, reservedQuantity: 2 },
        }),
        makeProduct({
          id: "reserved",
          inventory: { quantity: 2, reservedQuantity: 2 },
        }),
      ]);

      const result = await service.getProducts({ inStock: false });

      expect(result.map((product) => product.id)).toEqual([
        "available",
        "reserved",
      ]);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            inventory: expect.anything(),
          }),
        }),
      );
    });

    it("pages over sellable rows, not database rows", async () => {
      const { service, prisma } = makeService();

      // Page 2 (skip 2, take 2) must skip the unavailable row instead of
      // letting the database offset swallow a sellable product.
      prisma.product.findMany.mockResolvedValue([
        makeProduct({ id: "a" }),
        makeProduct({ id: "dead", inventory: { quantity: 1, reservedQuantity: 1 } }),
        makeProduct({ id: "b" }),
        makeProduct({ id: "c" }),
        makeProduct({ id: "d" }),
      ]);

      const result = await service.getProducts({ take: 2, skip: 2 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
      expect(result.map((product) => product.id)).toEqual(["c", "d"]);
    });

    it("sorts by price in both directions, by newest and by trending", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue([]);

      await service.getProducts({ sort: "price_asc" });
      await service.getProducts({ sort: "price_desc" });
      await service.getProducts({ sort: "newest" });
      await service.getProducts({ sort: "trending" });

      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          orderBy: [{ price: "asc" }, { id: "asc" }],
        }),
      );
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          orderBy: [{ price: "desc" }, { id: "asc" }],
        }),
      );
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        }),
      );
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({
          orderBy: [{ reviews: { _count: "desc" } }, { id: "asc" }],
        }),
      );
    });

    it("caps live-search suggestions after ranking", async () => {
      const { service, prisma } = makeService();

      prisma.product.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, index) =>
          makeProduct({ id: `p${index}`, name: `Tomato ${index}` }),
        ),
      );

      const result = await service.getProducts({ search: "tomato", take: 6 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 24 }),
      );
      expect(result).toHaveLength(6);
    });
  });

  describe("getProductFacets (filter options)", () => {
    it("derives unique locations and seller options from active listings", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findMany.mockResolvedValue([
        { id: "s1", businessName: "A Farm", city: "Tzaneen", province: "Limpopo" },
        { id: "s2", businessName: "B Farm", city: "Polokwane", province: "Limpopo" },
        { id: "s3", businessName: "C Farm", city: null, province: null },
      ]);
      prisma.product.aggregate.mockResolvedValue({
        _min: { price: 5 },
        _max: { price: 1250.5 },
      });

      const facets = await service.getProductFacets();

      expect(facets.provinces).toEqual(["Limpopo"]);
      expect(facets.cities).toEqual(["Polokwane", "Tzaneen"]);
      expect(facets.suppliers).toHaveLength(3);
      expect(facets.priceRange).toEqual({ min: 5, max: 1250.5 });
      expect(prisma.supplierProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { products: { some: { status: "ACTIVE" } } },
        }),
      );
    });

    it("returns null bounds when no active products exist", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findMany.mockResolvedValue([]);
      prisma.product.aggregate.mockResolvedValue({
        _min: { price: null },
        _max: { price: null },
      });

      const facets = await service.getProductFacets();

      expect(facets.priceRange).toEqual({ min: null, max: null });
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

    it("rejects a category that is not a platform category", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.createProduct("supplier-user-1", {
          categoryId: "11111111-2222-4333-8444-555555555555",
          name: "Mystery crop",
          slug: "mystery-crop",
          sku: "BON-MYS-1",
          price: 10,
          unit: "kg",
        } as never),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.category.findUnique).toHaveBeenCalledWith({
        where: { id: "11111111-2222-4333-8444-555555555555" },
        select: { id: true },
      });
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    // CP17: drafts are free, publishing is not.
    it("lets an unverified supplier save a DRAFT but blocks ACTIVE", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        user: { businessStatus: "NOT_STARTED" },
      });
      prisma.product.create.mockResolvedValue({ id: "prod-draft" });

      const draft = await service.createProduct("supplier-user-1", {
        categoryId: "cat-1",
        name: "Tomatoes 1kg",
        slug: "tomatoes-1kg",
        sku: "BON-TOM-1",
        price: 25,
        unit: "kg",
      } as never);

      expect(draft).toEqual({ id: "prod-draft" });

      const error = await service
        .createProduct("supplier-user-1", {
          categoryId: "cat-1",
          name: "Tomatoes 1kg",
          slug: "tomatoes-1kg",
          sku: "BON-TOM-2",
          price: 25,
          unit: "kg",
          status: "ACTIVE",
        } as never)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "BUSINESS_VERIFICATION_REQUIRED",
        businessStatus: "NOT_STARTED",
      });
      expect(prisma.product.create).toHaveBeenCalledTimes(1);
    });

    it("blocks activating a listing while verification is rejected", async () => {
      const { service, prisma } = makeService();

      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: null,
        status: "DRAFT",
        supplier: { user: { businessStatus: "REJECTED" } },
      });

      const error = await service
        .updateProduct("prod-1", "supplier-user-1", { status: "ACTIVE" } as never)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "BUSINESS_VERIFICATION_REQUIRED",
      });
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it("keeps an already-ACTIVE listing editable without re-verification", async () => {
      const { service, prisma } = makeService();

      prisma.product.findFirst.mockResolvedValue({
        id: "prod-1",
        imagePublicId: null,
        status: "ACTIVE",
        supplier: { user: { businessStatus: "NOT_STARTED" } },
      });
      prisma.product.update.mockResolvedValue({ id: "prod-1" });

      await expect(
        service.updateProduct("prod-1", "supplier-user-1", {
          price: 26,
          status: "ACTIVE",
        } as never),
      ).resolves.toEqual({ id: "prod-1" });
      expect(prisma.product.update).toHaveBeenCalled();
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
      user: { businessStatus: "VERIFIED" },
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

  describe("updateSupplierProfile (settings details)", () => {
    it("saves the business details a vendor edits on its settings screen", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: null,
      });
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", {
        businessName: "  Marula Fresh Produce ",
        description: "  Leafy greens from Tzaneen  ",
        phone: "015 000 0001",
        email: "sales@marula.co.za",
        address: "12 Market St",
        city: "Tzaneen",
        province: "Limpopo",
      });

      expect(prisma.supplierProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sup-1" },
          data: {
            businessName: "Marula Fresh Produce",
            description: "Leafy greens from Tzaneen",
            phone: "015 000 0001",
            email: "sales@marula.co.za",
            address: "12 Market St",
            city: "Tzaneen",
            province: "Limpopo",
          },
        }),
      );
    });

    it("stores blanked optional details as null", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: null,
      });
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", {
        phone: "",
        description: "   ",
      });

      expect(prisma.supplierProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone: null, description: null },
        }),
      );
    });

    it("refuses to blank the business name", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: null,
      });

      await expect(
        service.updateSupplierProfile("supplier-user-1", {
          businessName: "   ",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.supplierProfile.update).not.toHaveBeenCalled();
    });

    it("never lets an admin-owned field through", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        logoPublicId: null,
      });
      prisma.supplierProfile.update.mockResolvedValue({ id: "sup-1" });

      await service.updateSupplierProfile("supplier-user-1", {
        businessName: "Marula Fresh Produce",
        registrationNo: "9999/000000/00",
        verified: true,
      } as never);

      const data = prisma.supplierProfile.update.mock.calls[0][0].data;
      expect(data).toEqual({ businessName: "Marula Fresh Produce" });
      expect(data).not.toHaveProperty("registrationNo");
      expect(data).not.toHaveProperty("verified");
    });
  });

  describe("getSupplierStorefront (promoted shop destination)", () => {
    it("returns only the public shop shape and its active products", async () => {
      const { service, prisma, reviews } = makeService();
      const product = makeProduct();
      prisma.supplierProfile.findUnique.mockResolvedValue({
        id: "sup-1",
        businessName: "BonAgri Farm",
        description: "Local produce",
        logoUrl: null,
        city: "Polokwane",
        province: "Limpopo",
        verified: true,
        products: [product],
      });

      const storefront = await service.getSupplierStorefront("sup-1");

      expect(prisma.supplierProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sup-1" },
          select: expect.objectContaining({
            businessName: true,
            products: expect.objectContaining({
              where: { status: "ACTIVE" },
            }),
          }),
        }),
      );
      expect(reviews.attachSummaries).toHaveBeenCalledWith([product]);
      expect(storefront.businessName).toBe("BonAgri Farm");
      expect(storefront.products).toEqual([product]);
    });

    it("404s for an unknown shop", async () => {
      const { service, prisma } = makeService();
      prisma.supplierProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.getSupplierStorefront("missing"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
