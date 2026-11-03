import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  effectiveCampaignStatus,
  PromotionsService,
} from "./promotions.service";

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Fresh Tomatoes",
    slug: "fresh-tomatoes",
    price: "20.00",
    unit: "kg",
    status: "ACTIVE",
    imageUrl: null,
    createdAt: new Date("2026-01-01"),
    supplier: {
      id: "sup-1",
      businessName: "BonAgri Farm",
      city: "Polokwane",
      province: "Limpopo",
      lat: -23.9045,
      lng: 29.4689,
      verified: true,
    },
    inventory: { quantity: 10, reservedQuantity: 0 },
    ...overrides,
  };
}

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp-1",
    name: "Harvest picks",
    headline: "Fresh from the farm",
    description: "This week's best produce.",
    type: "FEATURED_PRODUCTS",
    status: "ACTIVE",
    layout: "BANNER",
    placement: "HOME_TOP",
    priority: 0,
    ctaText: "View offer",
    tone: "from-[#17633a] to-[#0c3f23]",
    isSponsored: false,
    startAt: null,
    expiresAt: null,
    destinationType: "NONE",
    destinationProductId: null,
    destinationCategoryId: null,
    destinationSupplierId: null,
    impressions: 0,
    clicks: 0,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    images: [],
    products: [
      {
        id: "link-1",
        campaignId: "cmp-1",
        productId: "prod-1",
        promoPrice: null,
        sortOrder: 0,
        product: makeProduct(),
      },
    ],
    ...overrides,
  };
}

function makeService() {
  const prisma = {
    $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
    promoCampaign: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    promoCampaignEvent: { create: jest.fn() },
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    category: { findUnique: jest.fn() },
    supplierProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const media = {
    derivePublicId: jest.fn((url?: string | null) =>
      url ? "bonagri/promotion/derived" : null,
    ),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new PromotionsService(prisma as never, media as never),
    prisma,
    media,
  };
}

const baseQuery = {
  placement: "HOME_TOP" as const,
  limit: 4,
};

describe("effectiveCampaignStatus", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("expires an active campaign by timestamp even when the status says ACTIVE", () => {
    expect(
      effectiveCampaignStatus(
        {
          status: "ACTIVE",
          startAt: new Date("2026-10-01T00:00:00.000Z"),
          expiresAt: new Date("2026-10-29T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("EXPIRED");
  });

  it("treats a future start as scheduled", () => {
    expect(
      effectiveCampaignStatus(
        {
          status: "ACTIVE",
          startAt: new Date("2026-11-01T00:00:00.000Z"),
          expiresAt: null,
        },
        now,
      ),
    ).toBe("SCHEDULED");
  });

  it("keeps drafts and paused campaigns hidden", () => {
    expect(
      effectiveCampaignStatus(
        { status: "DRAFT", startAt: null, expiresAt: null },
        now,
      ),
    ).toBe("DRAFT");
    expect(
      effectiveCampaignStatus(
        { status: "PAUSED", startAt: null, expiresAt: null },
        now,
      ),
    ).toBe("PAUSED");
  });
});

describe("PromotionsService public feed", () => {
  it("resolves a featured product campaign with a real destination", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([makeCampaign()]);

    const result = await service.getActivePromotions(baseQuery);

    expect(result).toHaveLength(1);
    expect(result[0].products[0]).toEqual(
      expect.objectContaining({
        id: "prod-1",
        name: "Fresh Tomatoes",
        price: "20.00",
        supplierName: "BonAgri Farm",
      }),
    );
    expect(result[0].destination).toEqual({
      type: "PRODUCT",
      productId: "prod-1",
      url: "/products/prod-1",
    });
  });

  it("drops an expired campaign even if a stale row is returned", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({ expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
    ]);

    await expect(service.getActivePromotions(baseQuery)).resolves.toEqual([]);
  });

  it("does not show products that are unpublished or sold out", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        products: [
          {
            id: "link-1",
            campaignId: "cmp-1",
            productId: "prod-1",
            promoPrice: null,
            sortOrder: 0,
            product: makeProduct({
              status: "INACTIVE",
            }),
          },
        ],
      }),
    ]);

    await expect(service.getActivePromotions(baseQuery)).resolves.toEqual([]);
  });

  it("never invents a discount for a special offer", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        type: "SPECIAL_OFFERS",
        products: [
          {
            id: "link-1",
            campaignId: "cmp-1",
            productId: "prod-1",
            promoPrice: "20.00",
            sortOrder: 0,
            product: makeProduct(),
          },
        ],
      }),
    ]);

    await expect(service.getActivePromotions(baseQuery)).resolves.toEqual([]);
  });

  it("shows a genuine special offer with a computed discount", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        type: "SPECIAL_OFFERS",
        products: [
          {
            id: "link-1",
            campaignId: "cmp-1",
            productId: "prod-1",
            promoPrice: "15.00",
            sortOrder: 0,
            product: makeProduct(),
          },
        ],
      }),
    ]);

    const [campaign] = await service.getActivePromotions(baseQuery);
    expect(campaign.products[0]).toEqual(
      expect.objectContaining({
        promoPrice: "15.00",
        discountPercent: 25,
      }),
    );
  });

  it("drops a campaign whose destination product is no longer available", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        destinationType: "PRODUCT",
        destinationProductId: "prod-2",
      }),
    ]);
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.getActivePromotions(baseQuery)).resolves.toEqual([]);
  });

  it("asks for a location instead of inventing nearby products", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({ type: "NEAR_YOU" }),
    ]);

    const [campaign] = await service.getActivePromotions(baseQuery);

    expect(campaign.nearYou).toEqual({
      needsLocation: true,
      locationLabel: null,
      locationOptions: ["Polokwane"],
    });
    expect(campaign.products).toEqual([]);
  });

  it("filters near-you products by the chosen city", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({ type: "NEAR_YOU" }),
    ]);

    const [campaign] = await service.getActivePromotions({
      ...baseQuery,
      city: "polokwane",
    });

    expect(campaign.nearYou?.needsLocation).toBe(false);
    expect(campaign.products).toHaveLength(1);
  });

  it("links category campaigns to the public category feed", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        type: "DISCOVER_CATEGORIES",
        destinationType: "CATEGORY",
        destinationCategoryId: "cat-1",
      }),
    ]);
    prisma.category.findUnique.mockResolvedValue({
      id: "cat-1",
      name: "Fresh Produce",
      slug: "fresh-produce",
      imageUrl: null,
    });

    const [campaign] = await service.getActivePromotions(baseQuery);

    expect(campaign.destination).toEqual({
      type: "CATEGORY",
      categoryId: "cat-1",
      url: "/?cat=Fresh%20Produce",
    });
    expect(campaign.category).toEqual(
      expect.objectContaining({ name: "Fresh Produce" }),
    );
  });

  it("links shop campaigns to the public storefront", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({
        type: "FEATURED_SHOPS",
        destinationType: "SHOP",
        destinationSupplierId: "sup-1",
      }),
    ]);
    prisma.supplierProfile.findUnique.mockResolvedValue({
      id: "sup-1",
      businessName: "BonAgri Farm",
      description: "Local produce",
      logoUrl: null,
      city: "Polokwane",
      province: "Limpopo",
      verified: true,
      products: [makeProduct()],
      _count: { products: 1 },
    });

    const [campaign] = await service.getActivePromotions(baseQuery);

    expect(campaign.destination).toEqual({
      type: "SHOP",
      shopId: "sup-1",
      url: "/shops/sup-1",
    });
    expect(campaign.shop).toEqual(
      expect.objectContaining({ name: "BonAgri Farm", productCount: 1 }),
    );
  });
});

describe("PromotionsService admin lifecycle", () => {
  it("lets a draft be saved without content", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.create.mockResolvedValue({ id: "cmp-1" });
    prisma.promoCampaign.findUnique.mockResolvedValue(
      makeCampaign({ status: "DRAFT", products: [] }),
    );

    await service.createCampaign({
      name: "New campaign",
      headline: "Coming soon",
      type: "FEATURED_PRODUCTS",
      status: "DRAFT",
    });

    expect(prisma.promoCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      }),
    );
  });

  it("refuses to publish without any products", async () => {
    const { service, prisma } = makeService();

    await expect(
      service.createCampaign({
        name: "New campaign",
        headline: "Fresh picks",
        type: "FEATURED_PRODUCTS",
        status: "ACTIVE",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.promoCampaign.create).not.toHaveBeenCalled();
  });

  it("rejects a special offer that is not actually cheaper", async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { id: "prod-1", price: "20.00", status: "ACTIVE", name: "Tomatoes" },
    ]);

    await expect(
      service.createCampaign({
        name: "Offer",
        headline: "Save now",
        type: "SPECIAL_OFFERS",
        status: "ACTIVE",
        products: [{ productId: "prod-1", promoPrice: 25 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("turns a future start date into a scheduled campaign", async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { id: "prod-1", price: "20.00", status: "ACTIVE", name: "Tomatoes" },
    ]);
    prisma.promoCampaign.create.mockResolvedValue({ id: "cmp-1" });
    prisma.promoCampaign.findUnique.mockResolvedValue(makeCampaign());

    await service.createCampaign({
      name: "Scheduled",
      headline: "Next week",
      type: "FEATURED_PRODUCTS",
      status: "ACTIVE",
      startAt: "2999-01-01T00:00:00.000Z",
      expiresAt: "3000-01-01T00:00:00.000Z",
      products: [{ productId: "prod-1" }],
    });

    expect(prisma.promoCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      }),
    );
  });

  it("refuses a past expiry when publishing", async () => {
    const { service, prisma } = makeService();
    prisma.product.findMany.mockResolvedValue([
      { id: "prod-1", price: "20.00", status: "ACTIVE", name: "Tomatoes" },
    ]);

    await expect(
      service.createCampaign({
        name: "Expired",
        headline: "Too late",
        type: "FEATURED_PRODUCTS",
        status: "ACTIVE",
        expiresAt: "2020-01-01T00:00:00.000Z",
        products: [{ productId: "prod-1" }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("destroys replaced campaign images on update", async () => {
    const { service, prisma, media } = makeService();
    prisma.promoCampaign.findUnique
      .mockResolvedValueOnce(
        makeCampaign({
          images: [
            {
              id: "img-1",
              campaignId: "cmp-1",
              url: "https://res.cloudinary.com/demo/image/upload/v1/bonagri/promotion/old.jpg",
              publicId: "bonagri/promotion/old",
              alt: null,
              sortOrder: 0,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeCampaign());
    prisma.product.findMany.mockResolvedValue([
      { id: "prod-1", price: "20.00", status: "ACTIVE", name: "Tomatoes" },
    ]);

    await service.updateCampaign("cmp-1", {
      images: [
        {
          url: "https://res.cloudinary.com/demo/image/upload/v1/bonagri/promotion/new.jpg",
        },
      ],
    });

    expect(media.destroyAsset).toHaveBeenCalledWith("bonagri/promotion/old");
  });

  it("publishes a paused campaign through the lifecycle action", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findUnique.mockResolvedValue(
      makeCampaign({ status: "PAUSED" }),
    );
    prisma.product.findMany.mockResolvedValue([
      { id: "prod-1", price: "20.00", status: "ACTIVE", name: "Tomatoes" },
    ]);

    await service.publishCampaign("cmp-1");

    expect(prisma.promoCampaign.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { status: "ACTIVE" },
    });
  });

  it("throws for an unknown campaign", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findUnique.mockResolvedValue(null);

    await expect(service.getCampaign("missing")).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("PromotionsService analytics", () => {
  it("counts an impression once per idempotency key", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaignEvent.create
      .mockResolvedValueOnce({ id: "evt-1" })
      .mockRejectedValueOnce({ code: "P2002" });
    prisma.promoCampaign.update.mockResolvedValue({});

    const result = await service.trackEvents({
      events: [
        {
          campaignId: "cmp-1",
          type: "IMPRESSION",
          eventKey: "cmp-1:imp:session-1",
        },
        {
          campaignId: "cmp-1",
          type: "IMPRESSION",
          eventKey: "cmp-1:imp:session-1",
        },
      ],
    });

    expect(result).toEqual({ accepted: 1 });
    expect(prisma.promoCampaign.update).toHaveBeenCalledTimes(1);
  });

  it("ignores events for campaigns that no longer exist", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaignEvent.create.mockRejectedValue({ code: "P2003" });

    const result = await service.trackEvents({
      events: [
        {
          campaignId: "deleted",
          type: "CLICK",
          eventKey: "deleted:click:1",
        },
      ],
    });

    expect(result).toEqual({ accepted: 0 });
  });
});

describe("PromotionsService admin overview", () => {
  it("computes effective counts and click-through rate", async () => {
    const { service, prisma } = makeService();
    const now = new Date();
    prisma.promoCampaign.findMany.mockResolvedValue([
      {
        status: "ACTIVE",
        startAt: null,
        expiresAt: null,
        impressions: 100,
        clicks: 10,
      },
      {
        status: "ACTIVE",
        startAt: null,
        expiresAt: new Date(now.getTime() - 1000),
        impressions: 50,
        clicks: 5,
      },
      {
        status: "PAUSED",
        startAt: null,
        expiresAt: null,
        impressions: 10,
        clicks: 1,
      },
      {
        status: "SCHEDULED",
        startAt: new Date(now.getTime() + 86_400_000),
        expiresAt: null,
        impressions: 0,
        clicks: 0,
      },
      {
        status: "DRAFT",
        startAt: null,
        expiresAt: null,
        impressions: 0,
        clicks: 0,
      },
    ]);

    const stats = await service.getStats();

    expect(stats).toEqual({
      total: 5,
      active: 1,
      scheduled: 1,
      expired: 1,
      paused: 1,
      draft: 1,
      impressions: 160,
      clicks: 16,
      clickThroughRate: 10,
    });
  });

  it("filters the admin list by effective status", async () => {
    const { service, prisma } = makeService();
    prisma.promoCampaign.findMany.mockResolvedValue([
      makeCampaign({ id: "active-1" }),
      makeCampaign({
        id: "expired-1",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ]);

    const rows = await service.listCampaigns({ status: "EXPIRED" });

    expect(rows.map((row) => row.id)).toEqual(["expired-1"]);
  });
});
