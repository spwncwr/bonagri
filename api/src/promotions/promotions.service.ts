import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../media/media.service";
import {
  CreatePromoCampaignDto,
  ListAdminCampaignsDto,
  ListPromotionsDto,
  PROMO_CAMPAIGN_PLACEMENTS,
  TrackPromoEventsDto,
  UpdatePromoCampaignDto,
  type PromoCampaignPlacementValue,
  type PromoCampaignStatusValue,
  type PromoCampaignTypeValue,
  type PromoDestinationTypeValue,
} from "./dto/promotions.dto";

const promotionInclude = {
  images: { orderBy: { sortOrder: "asc" } },
  products: {
    orderBy: { sortOrder: "asc" },
    include: {
      product: {
        include: {
          supplier: {
            select: {
              id: true,
              businessName: true,
              city: true,
              province: true,
              lat: true,
              lng: true,
              verified: true,
            },
          },
          inventory: { select: { quantity: true, reservedQuantity: true } },
        },
      },
    },
  },
} satisfies Prisma.PromoCampaignInclude;

const publicProductInclude = {
  supplier: {
    select: {
      id: true,
      businessName: true,
      city: true,
      province: true,
      lat: true,
      lng: true,
      verified: true,
    },
  },
  inventory: { select: { quantity: true, reservedQuantity: true } },
} satisfies Prisma.ProductInclude;

type CampaignRecord = Prisma.PromoCampaignGetPayload<{
  include: typeof promotionInclude;
}>;

type PublicProductRecord = Prisma.ProductGetPayload<{
  include: typeof publicProductInclude;
}>;

type CategoryRecord = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
};

type ShopRecord = {
  id: string;
  businessName: string;
  description: string | null;
  logoUrl: string | null;
  city: string | null;
  province: string | null;
  verified: boolean;
  productCount: number;
  products: PublicProductRecord[];
};

type ProductForCard = {
  id: string;
  name: string;
  slug: string;
  price: unknown;
  imageUrl: string | null;
  unit: string;
  supplier: {
    id: string;
    businessName: string;
    city: string | null;
    province: string | null;
    lat: number | null;
    lng: number | null;
  };
  inventory: { quantity: number; reservedQuantity: number } | null;
};

type PublicPromoProduct = {
  id: string;
  name: string;
  slug: string;
  price: string;
  promoPrice: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
  unit: string;
  supplierId: string;
  supplierName: string;
  supplierCity: string | null;
  supplierProvince: string | null;
  availableQuantity: number;
  distanceKm: number | null;
};

type NormalizedCampaign = {
  name: string;
  headline: string;
  description: string | null;
  type: PromoCampaignTypeValue;
  status: PromoCampaignStatusValue | "EXPIRED";
  layout: "BANNER" | "SPLIT" | "COMPACT" | "EDITORIAL" | "CAROUSEL";
  placement: PromoCampaignPlacementValue;
  priority: number;
  ctaText: string;
  tone: string;
  isSponsored: boolean;
  startAt: Date | null;
  expiresAt: Date | null;
  destinationType: PromoDestinationTypeValue;
  destinationId: string | null;
  images: Array<{ url: string; alt: string | null }>;
  products: Array<{ productId: string; promoPrice: number | null }>;
};

export type PromoEffectiveStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "EXPIRED";

export function effectiveCampaignStatus(
  campaign: {
    status: PromoCampaignStatusValue | "EXPIRED";
    startAt: Date | null;
    expiresAt: Date | null;
  },
  now = new Date(),
): PromoEffectiveStatus {
  if (campaign.status === "DRAFT") return "DRAFT";
  if (campaign.status === "PAUSED") return "PAUSED";
  if (campaign.status === "EXPIRED") return "EXPIRED";
  if (campaign.expiresAt && campaign.expiresAt <= now) return "EXPIRED";
  if (campaign.startAt && campaign.startAt > now) return "SCHEDULED";
  return "ACTIVE";
}

function isProductAvailable(product: {
  inventory: { quantity: number; reservedQuantity: number } | null;
}) {
  if (!product.inventory) return false;
  return product.inventory.quantity - product.inventory.reservedQuantity > 0;
}

function availableQuantity(product: {
  inventory: { quantity: number; reservedQuantity: number } | null;
}) {
  if (!product.inventory) return 0;
  return Math.max(
    0,
    product.inventory.quantity - product.inventory.reservedQuantity,
  );
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const radius = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function uniqueSorted(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((left, right) => left.localeCompare(right));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  // ── Public feed ───────────────────────────────────────────────────────────

  async getActivePromotions(query: ListPromotionsDto) {
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new BadRequestException(
        "Provide both latitude and longitude, or neither",
      );
    }

    const now = new Date();
    const take = query.limit ?? 4;

    // Bounded superset: campaigns whose destination/content stopped being
    // public are dropped after resolution, so a few spare rows are fetched.
    const campaigns = await this.prisma.promoCampaign.findMany({
      where: {
        placement: query.placement,
        status: { in: ["ACTIVE", "SCHEDULED"] },
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      include: promotionInclude,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: Math.min(Math.max(take * 3, 6), 20),
    });

    const resolved = await Promise.all(
      campaigns.map((campaign) => this.toPublicCampaign(campaign, query)),
    );

    return resolved
      .filter((campaign): campaign is NonNullable<typeof campaign> =>
        Boolean(campaign),
      )
      .slice(0, take);
  }

  private async toPublicCampaign(
    campaign: CampaignRecord,
    query: ListPromotionsDto,
    options: { ignoreSchedule?: boolean } = {},
  ) {
    const now = new Date();
    if (
      !options.ignoreSchedule &&
      effectiveCampaignStatus(campaign, now) !== "ACTIVE"
    ) {
      return null;
    }

    const destinationProduct =
      campaign.destinationType === "PRODUCT" && campaign.destinationProductId
        ? await this.findPublicProduct(campaign.destinationProductId)
        : null;

    // A promoted product that was unpublished, deleted or sold out must not
    // leave a dead card in the feed.
    if (campaign.destinationType === "PRODUCT" && !destinationProduct) {
      return null;
    }

    let category: CategoryRecord | null = null;
    if (
      campaign.type === "DISCOVER_CATEGORIES" ||
      campaign.destinationType === "CATEGORY"
    ) {
      if (
        campaign.destinationType !== "CATEGORY" ||
        !campaign.destinationCategoryId
      ) {
        return null;
      }
      category = await this.prisma.category.findUnique({
        where: { id: campaign.destinationCategoryId },
        select: { id: true, name: true, slug: true, imageUrl: true },
      });
      if (!category) return null;
    }

    let shop: ShopRecord | null = null;
    if (
      campaign.type === "FEATURED_SHOPS" ||
      campaign.destinationType === "SHOP"
    ) {
      if (
        campaign.destinationType !== "SHOP" ||
        !campaign.destinationSupplierId
      ) {
        return null;
      }
      shop = await this.findPublicShop(campaign.destinationSupplierId);
      if (!shop) return null;
    }

    const linked = campaign.products
      .map((link) => ({ link, product: link.product }))
      .filter(
        ({ product }) =>
          product.status === "ACTIVE" && isProductAvailable(product),
      );

    let products: PublicPromoProduct[] = [];
    let nearYou: {
      needsLocation: boolean;
      locationLabel: string | null;
      locationOptions: string[];
    } | null = null;

    if (campaign.type === "DISCOVER_CATEGORIES") {
      // Category cards carry their own imagery and copy.
    } else if (campaign.type === "FEATURED_SHOPS") {
      products = shop ? shop.products.map((product) => this.mapProduct(product)) : [];
    } else if (campaign.type === "SPECIAL_OFFERS") {
      // Only genuine reductions are shown; an item whose promo price is not
      // below the live price is silently omitted rather than mislabelled.
      products = linked
        .map(({ link, product }) =>
          this.mapProduct(
            product,
            link.promoPrice === null ? null : Number(link.promoPrice),
          ),
        )
        .filter((product) => product.promoPrice !== null);
      if (products.length === 0) return null;
    } else if (campaign.type === "NEAR_YOU") {
      if (linked.length === 0) return null;
      const location = this.resolveLocation(
        linked.map(({ product }) => product),
        query,
      );
      nearYou = {
        needsLocation: !location.hasLocation,
        locationLabel: location.label,
        locationOptions: location.options,
      };
      if (location.hasLocation) {
        products = linked
          .filter(({ product }) => location.matches(product))
          .map(({ link, product }) =>
            this.mapProduct(
              product,
              link.promoPrice === null ? null : Number(link.promoPrice),
              this.distanceFor(product, query),
            ),
          );
        if (products.length === 0) return null;
      }
    } else {
      products = linked.map(({ link, product }) =>
        this.mapProduct(
          product,
          link.promoPrice === null ? null : Number(link.promoPrice),
        ),
      );
      if (
        destinationProduct &&
        !products.some((product) => product.id === destinationProduct.id)
      ) {
        products.unshift(this.mapProduct(destinationProduct));
      }
      if (products.length === 0) return null;
    }

    let destination = this.explicitDestination(
      campaign,
      destinationProduct,
      category,
      shop,
    );

    if (!destination) {
      if (category) {
        destination = {
          type: "CATEGORY",
          categoryId: category.id,
          url: `/?cat=${encodeURIComponent(category.name)}`,
        };
      } else if (shop) {
        destination = {
          type: "SHOP",
          shopId: shop.id,
          url: `/shops/${shop.id}`,
        };
      } else if (products.length > 0) {
        destination = {
          type: "PRODUCT",
          productId: products[0].id,
          url: `/products/${products[0].id}`,
        };
      } else if (linked.length > 0) {
        // A near-you card waiting for a location has no visible products yet,
        // but still needs a safe fallback action for non-location clicks.
        destination = {
          type: "PRODUCT",
          productId: linked[0].product.id,
          url: `/products/${linked[0].product.id}`,
        };
      }
    }

    if (!destination) return null;

    const heroImageUrl =
      campaign.images[0]?.url ??
      category?.imageUrl ??
      shop?.logoUrl ??
      products[0]?.imageUrl ??
      null;

    return {
      id: campaign.id,
      name: campaign.name,
      headline: campaign.headline,
      description: campaign.description,
      type: campaign.type,
      layout: campaign.layout,
      placement: campaign.placement,
      priority: campaign.priority,
      ctaText: campaign.ctaText,
      tone: campaign.tone,
      isSponsored: campaign.isSponsored,
      startAt: campaign.startAt?.toISOString() ?? null,
      expiresAt: campaign.expiresAt?.toISOString() ?? null,
      destination,
      images: campaign.images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
      })),
      heroImageUrl,
      products,
      category,
      shop: shop
        ? {
            id: shop.id,
            name: shop.businessName,
            description: shop.description,
            logoUrl: shop.logoUrl,
            city: shop.city,
            province: shop.province,
            verified: shop.verified,
            productCount: shop.productCount,
          }
        : null,
      nearYou,
    };
  }

  private async findPublicProduct(
    productId: string,
  ): Promise<PublicProductRecord | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: "ACTIVE" },
      include: publicProductInclude,
    });
    if (!product || !isProductAvailable(product)) return null;
    return product;
  }

  private async findPublicShop(supplierId: string): Promise<ShopRecord | null> {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        businessName: true,
        description: true,
        logoUrl: true,
        city: true,
        province: true,
        verified: true,
        products: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 4,
          include: publicProductInclude,
        },
        _count: { select: { products: true } },
      },
    });

    if (!supplier) return null;

    return {
      ...supplier,
      productCount: supplier._count.products,
      products: supplier.products.filter(isProductAvailable),
    };
  }

  private mapProduct(
    product: ProductForCard,
    promoPrice: number | null = null,
    distanceKm: number | null = null,
  ) {
    const price = Number(product.price);
    const genuinePromo =
      promoPrice !== null && promoPrice > 0 && promoPrice < price
        ? promoPrice
        : null;

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: price.toFixed(2),
      promoPrice: genuinePromo === null ? null : genuinePromo.toFixed(2),
      discountPercent:
        genuinePromo === null
          ? null
          : Math.round((1 - genuinePromo / price) * 100),
      imageUrl: product.imageUrl,
      unit: product.unit,
      supplierId: product.supplier.id,
      supplierName: product.supplier.businessName,
      supplierCity: product.supplier.city,
      supplierProvince: product.supplier.province,
      availableQuantity: availableQuantity(product),
      distanceKm:
        distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
    };
  }

  private resolveLocation(
    products: ProductForCard[],
    query: ListPromotionsDto,
  ) {
    const city = query.city?.trim() ?? "";
    const hasCoords = query.lat !== undefined && query.lng !== undefined;
    const hasLocation = Boolean(city) || hasCoords;

    return {
      hasLocation,
      label: city || (hasCoords ? "your area" : null),
      options: uniqueSorted(products.map((product) => product.supplier.city)),
      matches: (product: ProductForCard) => {
        if (city) {
          return (
            product.supplier.city?.toLowerCase() === city.toLowerCase()
          );
        }
        if (hasCoords) {
          const distance = this.distanceFor(product, query);
          return distance !== null && distance <= 150;
        }
        return false;
      },
    };
  }

  private distanceFor(
    product: ProductForCard,
    query: ListPromotionsDto,
  ): number | null {
    if (
      query.lat === undefined ||
      query.lng === undefined ||
      product.supplier.lat === null ||
      product.supplier.lng === null
    ) {
      return null;
    }
    return haversineKm(
      query.lat,
      query.lng,
      product.supplier.lat,
      product.supplier.lng,
    );
  }

  private explicitDestination(
    campaign: CampaignRecord,
    product: PublicProductRecord | null,
    category: CategoryRecord | null,
    shop: ShopRecord | null,
  ) {
    if (campaign.destinationType === "PRODUCT" && product) {
      return {
        type: "PRODUCT" as const,
        productId: product.id,
        url: `/products/${product.id}`,
      };
    }
    if (campaign.destinationType === "CATEGORY" && category) {
      return {
        type: "CATEGORY" as const,
        categoryId: category.id,
        url: `/?cat=${encodeURIComponent(category.name)}`,
      };
    }
    if (campaign.destinationType === "SHOP" && shop) {
      return {
        type: "SHOP" as const,
        shopId: shop.id,
        url: `/shops/${shop.id}`,
      };
    }
    return null;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async trackEvents(dto: TrackPromoEventsDto) {
    const events = [
      ...new Map(dto.events.map((event) => [event.eventKey, event])).values(),
    ];

    let accepted = 0;
    for (const event of events) {
      try {
        await this.prisma.$transaction([
          this.prisma.promoCampaignEvent.create({
            data: {
              campaignId: event.campaignId,
              type: event.type,
              eventKey: event.eventKey,
            },
          }),
          this.prisma.promoCampaign.update({
            where: { id: event.campaignId },
            data:
              event.type === "IMPRESSION"
                ? { impressions: { increment: 1 } }
                : { clicks: { increment: 1 } },
          }),
        ]);
        accepted += 1;
      } catch (error) {
        if (this.isUniqueViolation(error)) continue;
        // Unknown/deleted campaign or other write failure must never break the
        // marketplace — silently drop the event.
        if (this.isForeignKeyViolation(error)) continue;
        throw error;
      }
    }

    return { accepted };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    );
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2003"
    );
  }

  // ── Admin reads ───────────────────────────────────────────────────────────

  async listCampaigns(query: ListAdminCampaignsDto) {
    const search = query.search?.trim();
    const rows = await this.prisma.promoCampaign.findMany({
      where: {
        ...(query.placement ? { placement: query.placement } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { headline: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: promotionInclude,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    const shaped = rows.map((campaign) => this.toAdminCampaign(campaign));
    if (!query.status || query.status === "ALL") return shaped;
    return shaped.filter(
      (campaign) => campaign.effectiveStatus === query.status,
    );
  }

  async getCampaign(campaignId: string) {
    const campaign = await this.prisma.promoCampaign.findUnique({
      where: { id: campaignId },
      include: promotionInclude,
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return this.toAdminCampaign(campaign);
  }

  async getStats() {
    const rows = await this.prisma.promoCampaign.findMany({
      select: {
        status: true,
        startAt: true,
        expiresAt: true,
        impressions: true,
        clicks: true,
      },
    });

    const now = new Date();
    const totals = {
      total: rows.length,
      active: 0,
      scheduled: 0,
      expired: 0,
      paused: 0,
      draft: 0,
    };

    let impressions = 0;
    let clicks = 0;

    for (const row of rows) {
      const status = effectiveCampaignStatus(row, now);
      if (status === "ACTIVE") totals.active += 1;
      else if (status === "SCHEDULED") totals.scheduled += 1;
      else if (status === "EXPIRED") totals.expired += 1;
      else if (status === "PAUSED") totals.paused += 1;
      else totals.draft += 1;
      impressions += row.impressions;
      clicks += row.clicks;
    }

    return {
      ...totals,
      impressions,
      clicks,
      clickThroughRate:
        impressions === 0
          ? 0
          : Math.round((clicks / impressions) * 10000) / 100,
    };
  }

  async getOptions() {
    const [products, categories, shops] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          price: true,
          unit: true,
          imageUrl: true,
          category: { select: { name: true } },
          supplier: { select: { businessName: true } },
        },
        orderBy: { name: "asc" },
        take: 300,
      }),
      this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          _count: { select: { products: true } },
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.supplierProfile.findMany({
        where: { user: { status: "ACTIVE" } },
        select: {
          id: true,
          businessName: true,
          description: true,
          logoUrl: true,
          city: true,
          province: true,
          verified: true,
          _count: { select: { products: true } },
        },
        orderBy: { businessName: "asc" },
        take: 200,
      }),
    ]);

    return {
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        price: Number(product.price).toFixed(2),
        unit: product.unit,
        imageUrl: product.imageUrl,
        categoryName: product.category.name,
        supplierName: product.supplier.businessName,
      })),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        imageUrl: category.imageUrl,
        productCount: category._count.products,
      })),
      shops: shops.map((shop) => ({
        id: shop.id,
        name: shop.businessName,
        description: shop.description,
        logoUrl: shop.logoUrl,
        city: shop.city,
        province: shop.province,
        verified: shop.verified,
        productCount: shop._count.products,
      })),
    };
  }

  // ── Admin writes ──────────────────────────────────────────────────────────

  async createCampaign(dto: CreatePromoCampaignDto) {
    const normalized = await this.normalize(
      {
        name: dto.name,
        headline: dto.headline,
        description: dto.description ?? null,
        type: dto.type,
        status: dto.status ?? "DRAFT",
        layout: dto.layout ?? "BANNER",
        placement: dto.placement ?? "HOME_TOP",
        priority: dto.priority ?? 0,
        ctaText: dto.ctaText ?? "View offer",
        tone: dto.tone ?? "from-[#17633a] to-[#0c3f23]",
        isSponsored: dto.isSponsored ?? false,
        startAt: parseDate(dto.startAt),
        expiresAt: parseDate(dto.expiresAt),
        destinationType: dto.destinationType ?? "NONE",
        destinationId: dto.destinationId ?? null,
        images: dto.images ?? [],
        products: dto.products ?? [],
      },
      { statusWasExplicit: true },
    );

    await this.validate(normalized);

    const created = await this.prisma.promoCampaign.create({
      data: {
        ...this.toWriteData(normalized),
        images: { create: this.imagesCreate(normalized) },
        products: { create: this.productsCreate(normalized) },
      },
      select: { id: true },
    });

    return this.getCampaign(created.id);
  }

  async updateCampaign(campaignId: string, dto: UpdatePromoCampaignDto) {
    const existing = await this.prisma.promoCampaign.findUnique({
      where: { id: campaignId },
      include: promotionInclude,
    });
    if (!existing) throw new NotFoundException("Campaign not found");

    const existingDestinationId = this.destinationIdOf(existing);
    const type = dto.type ?? existing.type;

    let destinationType: PromoDestinationTypeValue =
      dto.destinationType ?? existing.destinationType;
    let destinationId: string | null;

    if (dto.destinationId !== undefined) {
      destinationId = dto.destinationId?.trim() || null;
    } else if (
      dto.destinationType !== undefined &&
      dto.destinationType !== existing.destinationType
    ) {
      destinationId = null;
    } else {
      destinationId = existingDestinationId;
    }

    // Campaign types with a mandatory destination kind.
    if (type === "DISCOVER_CATEGORIES") destinationType = "CATEGORY";
    if (type === "FEATURED_SHOPS") destinationType = "SHOP";

    const status = dto.status ?? existing.status;

    const normalized = await this.normalize(
      {
        name: dto.name ?? existing.name,
        headline: dto.headline ?? existing.headline,
        description:
          dto.description !== undefined
            ? dto.description
            : existing.description,
        type,
        status,
        layout: dto.layout ?? existing.layout,
        placement: dto.placement ?? existing.placement,
        priority: dto.priority ?? existing.priority,
        ctaText: dto.ctaText ?? existing.ctaText,
        tone: dto.tone ?? existing.tone ?? "from-[#17633a] to-[#0c3f23]",
        isSponsored: dto.isSponsored ?? existing.isSponsored,
        startAt:
          dto.startAt !== undefined
            ? parseDate(dto.startAt)
            : existing.startAt,
        expiresAt:
          dto.expiresAt !== undefined
            ? parseDate(dto.expiresAt)
            : existing.expiresAt,
        destinationType,
        destinationId,
        images:
          dto.images ??
          existing.images.map((image) => ({
            url: image.url,
            alt: image.alt,
          })),
        products:
          dto.products ??
          existing.products.map((link) => ({
            productId: link.productId,
            promoPrice:
              link.promoPrice === null ? null : Number(link.promoPrice),
          })),
      },
      { statusWasExplicit: dto.status !== undefined },
    );

    await this.validate(normalized);

    const nextUrls = new Set(normalized.images.map((image) => image.url));
    const removedAssetIds = existing.images
      .filter((image) => !nextUrls.has(image.url))
      .map((image) => image.publicId)
      .filter((publicId): publicId is string => Boolean(publicId));

    await this.prisma.promoCampaign.update({
      where: { id: campaignId },
      data: {
        ...this.toWriteData(normalized),
        images: { deleteMany: {}, create: this.imagesCreate(normalized) },
        products: { deleteMany: {}, create: this.productsCreate(normalized) },
      },
    });

    await Promise.all(
      removedAssetIds.map((publicId) =>
        this.mediaService.destroyAsset(publicId),
      ),
    );

    return this.getCampaign(campaignId);
  }

  async publishCampaign(campaignId: string) {
    return this.setLifecycleStatus(campaignId, "ACTIVE");
  }

  async pauseCampaign(campaignId: string) {
    return this.setLifecycleStatus(campaignId, "PAUSED");
  }

  async resumeCampaign(campaignId: string) {
    return this.setLifecycleStatus(campaignId, "ACTIVE");
  }

  async deleteCampaign(campaignId: string) {
    const existing = await this.prisma.promoCampaign.findUnique({
      where: { id: campaignId },
      include: { images: { select: { publicId: true } } },
    });
    if (!existing) throw new NotFoundException("Campaign not found");

    await this.prisma.promoCampaign.delete({ where: { id: campaignId } });

    await Promise.all(
      existing.images
        .map((image) => image.publicId)
        .filter((publicId): publicId is string => Boolean(publicId))
        .map((publicId) => this.mediaService.destroyAsset(publicId)),
    );

    return { success: true };
  }

  async previewCampaign(campaignId: string) {
    const campaign = await this.prisma.promoCampaign.findUnique({
      where: { id: campaignId },
      include: promotionInclude,
    });
    if (!campaign) throw new NotFoundException("Campaign not found");

    const preview = await this.toPublicCampaign(
      campaign,
      { placement: campaign.placement, limit: 1 },
      { ignoreSchedule: true },
    );

    if (!preview) {
      throw new BadRequestException(
        "This campaign has no publicly visible content to preview yet",
      );
    }

    return preview;
  }

  private async setLifecycleStatus(
    campaignId: string,
    target: "ACTIVE" | "PAUSED",
  ) {
    const existing = await this.prisma.promoCampaign.findUnique({
      where: { id: campaignId },
      include: promotionInclude,
    });
    if (!existing) throw new NotFoundException("Campaign not found");

    if (target === "PAUSED") {
      await this.prisma.promoCampaign.update({
        where: { id: campaignId },
        data: { status: "PAUSED" },
      });
      return this.getCampaign(campaignId);
    }

    const normalized = await this.normalize(
      {
        name: existing.name,
        headline: existing.headline,
        description: existing.description,
        type: existing.type,
        status: "ACTIVE",
        layout: existing.layout,
        placement: existing.placement,
        priority: existing.priority,
        ctaText: existing.ctaText,
        tone: existing.tone ?? "from-[#17633a] to-[#0c3f23]",
        isSponsored: existing.isSponsored,
        startAt: existing.startAt,
        expiresAt: existing.expiresAt,
        destinationType: existing.destinationType,
        destinationId: this.destinationIdOf(existing),
        images: existing.images.map((image) => ({
          url: image.url,
          alt: image.alt,
        })),
        products: existing.products.map((link) => ({
          productId: link.productId,
          promoPrice:
            link.promoPrice === null ? null : Number(link.promoPrice),
        })),
      },
      { statusWasExplicit: true },
    );

    await this.validate(normalized);
    await this.prisma.promoCampaign.update({
      where: { id: campaignId },
      data: { status: normalized.status },
    });
    return this.getCampaign(campaignId);
  }

  // ── Normalisation / validation ────────────────────────────────────────────

  private async normalize(
    input: {
      name: string;
      headline: string;
      description: string | null;
      type: PromoCampaignTypeValue;
      status: PromoCampaignStatusValue | "EXPIRED";
      layout: "BANNER" | "SPLIT" | "COMPACT" | "EDITORIAL" | "CAROUSEL";
      placement: PromoCampaignPlacementValue;
      priority: number;
      ctaText: string;
      tone: string;
      isSponsored: boolean;
      startAt: Date | null;
      expiresAt: Date | null;
      destinationType: PromoDestinationTypeValue;
      destinationId: string | null;
      images: Array<{ url: string; alt?: string | null }>;
      products: Array<{ productId: string; promoPrice?: number | null }>;
    },
    options: { statusWasExplicit: boolean },
  ): Promise<NormalizedCampaign> {
    const name = input.name.trim();
    const headline = input.headline.trim();
    if (!name) throw new BadRequestException("Campaign name is required");
    if (!headline) throw new BadRequestException("Headline is required");

    if (!PROMO_CAMPAIGN_PLACEMENTS.includes(input.placement)) {
      throw new BadRequestException("Unknown marketplace placement");
    }

    const startAt = input.startAt;
    const expiresAt = input.expiresAt;
    if (startAt && expiresAt && startAt >= expiresAt) {
      throw new BadRequestException("Expiry must be after the start date");
    }

    let status = input.status;
    if (status !== "DRAFT" && status !== "PAUSED" && status !== "EXPIRED") {
      const now = new Date();
      if (expiresAt && expiresAt <= now) {
        if (options.statusWasExplicit) {
          throw new BadRequestException(
            "Expiry must be in the future to publish a campaign",
          );
        }
        status = "EXPIRED";
      } else if (startAt && startAt > now) {
        status = "SCHEDULED";
      } else if (status === "SCHEDULED" && !startAt) {
        if (options.statusWasExplicit) {
          throw new BadRequestException(
            "Scheduled campaigns need a start date",
          );
        }
        status = "ACTIVE";
      } else {
        status = "ACTIVE";
      }
    }

    const images = [
      ...new Map(
        input.images
          .map((image) => ({
            url: image.url.trim(),
            alt: image.alt?.trim() || null,
          }))
          .filter((image) => Boolean(image.url))
          .map((image) => [image.url, image] as const),
      ).values(),
    ].slice(0, 6);

    const products = [
      ...new Map(
        input.products
          .filter((product) => Boolean(product.productId))
          .map((product) => [
            product.productId,
            {
              productId: product.productId,
              promoPrice:
                product.promoPrice === undefined ? null : product.promoPrice,
            },
          ] as const),
      ).values(),
    ].slice(0, 12);

    return {
      name,
      headline,
      description: input.description?.trim() || null,
      type: input.type,
      status,
      layout: input.layout,
      placement: input.placement,
      priority: Math.trunc(input.priority),
      ctaText: input.ctaText.trim() || "View offer",
      tone: input.tone.trim() || "from-[#17633a] to-[#0c3f23]",
      isSponsored: input.isSponsored,
      startAt,
      expiresAt,
      destinationType: input.destinationType,
      destinationId: input.destinationId?.trim() || null,
      images,
      products,
    };
  }

  private async validate(campaign: NormalizedCampaign) {
    const isDraft = campaign.status === "DRAFT";

    if (campaign.type === "DISCOVER_CATEGORIES") {
      campaign.destinationType = "CATEGORY";
    }
    if (campaign.type === "FEATURED_SHOPS") {
      campaign.destinationType = "SHOP";
    }

    if (campaign.destinationType !== "NONE") {
      if (!campaign.destinationId) {
        if (!isDraft) {
          throw new BadRequestException(
            "Choose a destination for this campaign",
          );
        }
      } else {
        await this.assertDestination(
          campaign.destinationType,
          campaign.destinationId,
        );
      }
    }

    if (
      campaign.type === "FEATURED_PRODUCTS" ||
      campaign.type === "SPECIAL_OFFERS" ||
      campaign.type === "NEAR_YOU"
    ) {
      if (campaign.products.length === 0) {
        if (!isDraft) {
          throw new BadRequestException(
            "Choose at least one product for this campaign type",
          );
        }
      } else {
        const products = await this.prisma.product.findMany({
          where: { id: { in: campaign.products.map((p) => p.productId) } },
          select: { id: true, price: true, status: true, name: true },
        });
        const byId = new Map(products.map((product) => [product.id, product]));

        for (const link of campaign.products) {
          const product = byId.get(link.productId);
          if (!product || product.status !== "ACTIVE") {
            throw new BadRequestException(
              "One or more selected products are not publicly available",
            );
          }

          if (campaign.type === "SPECIAL_OFFERS") {
            const price = Number(product.price);
            if (
              link.promoPrice === null ||
              link.promoPrice <= 0 ||
              link.promoPrice >= price
            ) {
              throw new BadRequestException(
                `Enter a promotional price below the live price for ${product.name}`,
              );
            }
          }

          if (
            campaign.type !== "SPECIAL_OFFERS" &&
            link.promoPrice !== null &&
            link.promoPrice >= Number(product.price)
          ) {
            throw new BadRequestException(
              `Promotional price must be below the live price for ${product.name}`,
            );
          }
        }
      }
    }

    if (campaign.status === "ACTIVE" || campaign.status === "SCHEDULED") {
      if (campaign.expiresAt && campaign.expiresAt <= new Date()) {
        throw new BadRequestException(
          "Expiry must be in the future to publish a campaign",
        );
      }
    }
  }

  private async assertDestination(
    type: PromoDestinationTypeValue,
    id: string,
  ) {
    if (type === "PRODUCT") {
      const product = await this.prisma.product.findFirst({
        where: { id, status: "ACTIVE" },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException(
          "The selected product is not publicly available",
        );
      }
      return;
    }

    if (type === "CATEGORY") {
      const category = await this.prisma.category.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException("The selected category no longer exists");
      }
      return;
    }

    if (type === "SHOP") {
      const shop = await this.prisma.supplierProfile.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!shop) {
        throw new BadRequestException("The selected shop no longer exists");
      }
    }
  }

  private toWriteData(campaign: NormalizedCampaign) {
    return {
      name: campaign.name,
      headline: campaign.headline,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      layout: campaign.layout,
      placement: campaign.placement,
      priority: campaign.priority,
      ctaText: campaign.ctaText,
      tone: campaign.tone,
      isSponsored: campaign.isSponsored,
      startAt: campaign.startAt,
      expiresAt: campaign.expiresAt,
      destinationType: campaign.destinationType,
      destinationProductId:
        campaign.destinationType === "PRODUCT"
          ? campaign.destinationId
          : null,
      destinationCategoryId:
        campaign.destinationType === "CATEGORY"
          ? campaign.destinationId
          : null,
      destinationSupplierId:
        campaign.destinationType === "SHOP" ? campaign.destinationId : null,
    };
  }

  private imagesCreate(campaign: NormalizedCampaign) {
    return campaign.images.map((image, index) => ({
      url: image.url,
      alt: image.alt,
      publicId: this.mediaService.derivePublicId(image.url),
      sortOrder: index,
    }));
  }

  private productsCreate(campaign: NormalizedCampaign) {
    return campaign.products.map((product, index) => ({
      productId: product.productId,
      promoPrice: product.promoPrice,
      sortOrder: index,
    }));
  }

  private destinationIdOf(campaign: {
    destinationType: PromoDestinationTypeValue;
    destinationProductId: string | null;
    destinationCategoryId: string | null;
    destinationSupplierId: string | null;
  }) {
    if (campaign.destinationType === "PRODUCT") {
      return campaign.destinationProductId;
    }
    if (campaign.destinationType === "CATEGORY") {
      return campaign.destinationCategoryId;
    }
    if (campaign.destinationType === "SHOP") {
      return campaign.destinationSupplierId;
    }
    return null;
  }

  private toAdminCampaign(campaign: CampaignRecord) {
    return {
      id: campaign.id,
      name: campaign.name,
      headline: campaign.headline,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      effectiveStatus: effectiveCampaignStatus(campaign),
      layout: campaign.layout,
      placement: campaign.placement,
      priority: campaign.priority,
      ctaText: campaign.ctaText,
      tone: campaign.tone,
      isSponsored: campaign.isSponsored,
      startAt: campaign.startAt?.toISOString() ?? null,
      expiresAt: campaign.expiresAt?.toISOString() ?? null,
      destinationType: campaign.destinationType,
      destinationId: this.destinationIdOf(campaign),
      images: campaign.images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder,
      })),
      products: campaign.products.map((link) => ({
        productId: link.productId,
        promoPrice:
          link.promoPrice === null ? null : Number(link.promoPrice),
        product: {
          id: link.product.id,
          name: link.product.name,
          price: Number(link.product.price).toFixed(2),
          unit: link.product.unit,
          imageUrl: link.product.imageUrl,
          status: link.product.status,
          supplierName: link.product.supplier.businessName,
        },
      })),
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      clickThroughRate:
        campaign.impressions === 0
          ? 0
          : Math.round((campaign.clicks / campaign.impressions) * 10000) / 100,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }
}
