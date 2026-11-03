import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../media/media.service";
import { ReviewsService } from "../reviews/reviews.service";
import { CreateProductDto } from "./dto/create-product.dto";
import type { ListProductsDto, ProductSort } from "./dto/list-products.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import { UpdateSupplierPinDto } from "./dto/update-supplier-pin.dto";
import { UpdateSupplierProfileDto } from "./dto/update-supplier-profile.dto";

type ListedProduct = {
  id: string;
  name: string;
  sku: string;
  category: { name: string };
  supplier: { businessName: string };
  inventory: { quantity: number; reservedQuantity: number } | null;
};

// Marketplace availability means sellable stock, not just a row in inventory:
// reserved units are already spoken for and a missing record is unknown, not
// available.
function isAvailable(product: { inventory: { quantity: number; reservedQuantity: number } | null }) {
  if (!product.inventory) return false;
  return product.inventory.quantity - product.inventory.reservedQuantity > 0;
}

function uniqueSorted(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((left, right) => left.localeCompare(right));
}

// Relevance is computed after the bounded DB read because Postgres `ILIKE`
// has no ranking of its own. Exact name > name prefix > name contains >
// category > supplier > sku > description.
function relevanceScore(product: ListedProduct, term: string) {
  const name = product.name.toLowerCase();
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (name.includes(term)) return 2;

  const category = product.category.name.toLowerCase();
  if (category === term) return 3;
  if (category.includes(term)) return 4;

  if (product.supplier.businessName.toLowerCase().includes(term)) return 5;
  if (product.sku.toLowerCase().includes(term)) return 6;

  return 7;
}

function orderByFor(
  sort: ProductSort | undefined,
  hasSearch: boolean,
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ price: "asc" }, { id: "asc" }];
    case "price_desc":
      return [{ price: "desc" }, { id: "asc" }];
    case "newest":
      return [{ createdAt: "desc" }, { id: "asc" }];
    case "trending":
      // Marketplace rails: most-reviewed first. Prisma's relation-aggregate
      // orderBy only supports _count, so rating is not a server tiebreaker.
      return [{ reviews: { _count: "desc" } }, { id: "asc" }];
    default:
      return hasSearch
        ? [{ name: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "asc" }];
  }
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    private readonly reviewsService: ReviewsService,
  ) {}

  async getCategories() {
    return this.prisma.category.findMany({
      orderBy: { name: "asc" },
    });
  }

  async getActiveBanners() {
    return this.prisma.promoBanner.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  // Filter options are derived from the live catalogue so the sheet can never
  // offer a province, city or seller with nothing to show behind it.
  async getProductFacets() {
    const [suppliers, price] = await Promise.all([
      this.prisma.supplierProfile.findMany({
        where: { products: { some: { status: "ACTIVE" } } },
        select: {
          id: true,
          businessName: true,
          city: true,
          province: true,
        },
        orderBy: { businessName: "asc" },
      }),
      this.prisma.product.aggregate({
        where: { status: "ACTIVE" },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);

    return {
      suppliers,
      provinces: uniqueSorted(suppliers.map((supplier) => supplier.province)),
      cities: uniqueSorted(suppliers.map((supplier) => supplier.city)),
      priceRange: {
        min: price._min.price === null ? null : Number(price._min.price),
        max: price._max.price === null ? null : Number(price._max.price),
      },
    };
  }

  async getProducts(query: ListProductsDto = {}) {
    const search = query.search?.trim() ?? "";
    const normalizedSearch = search.toLowerCase();

    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new BadRequestException(
        "Minimum price cannot exceed maximum price",
      );
    }

    const where: Prisma.ProductWhereInput = { status: "ACTIVE" };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        {
          category: {
            name: { contains: search, mode: "insensitive" },
          },
        },
        {
          supplier: {
            businessName: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }

    if (query.category) {
      where.category = { slug: query.category };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }

    if (query.province || query.city) {
      where.supplier = {
        ...(query.province
          ? { province: { equals: query.province, mode: "insensitive" } }
          : {}),
        ...(query.city
          ? { city: { equals: query.city, mode: "insensitive" } }
          : {}),
      };
    }

    if (query.inStock !== false) {
      // The marketplace never lists dead stock. Reserved-only rows and
      // missing inventory rows are trimmed below after the read; this
      // constraint just keeps the read from returning them in the first
      // place. Explicit `inStock=false` opts out (internal tooling).
      where.inventory = { is: { quantity: { gt: 0 } } };
    }

    // The sellable-stock trim (`quantity - reservedQuantity > 0`) happens in
    // JS because Prisma cannot compare two columns, so the database must not
    // skip rows itself: fetch a bounded window large enough to cover the
    // requested page after trimming, then slice the result.
    const dbTake = query.take
      ? Math.min((query.skip ?? 0) + query.take * 4, 200)
      : undefined;

    const products = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
      orderBy: orderByFor(query.sort, Boolean(search)),
      ...(dbTake ? { take: dbTake } : {}),
    });

    let rows =
      query.inStock !== false
        ? products.filter((product) => isAvailable(product))
        : products;

    if (search && (!query.sort || query.sort === "relevance")) {
      rows = rows
        .map((product) => ({ product, score: relevanceScore(product, normalizedSearch) }))
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.product.name.localeCompare(right.product.name) ||
            left.product.id.localeCompare(right.product.id),
        )
        .map((entry) => entry.product);
    }

    if (query.skip || query.take) {
      const start = query.skip ?? 0;
      rows = query.take
        ? rows.slice(start, start + query.take)
        : rows.slice(start);
    }

    // CP17: cards show the real average + count alongside the price.
    return this.reviewsService.attachSummaries(rows);
  }

  // Public storefront for a promoted shop. Only ACTIVE listings are returned
  // and supplier contact details that the app already exposes (city/province,
  // logo) are selected — no emails or account fields.
  async getSupplierStorefront(supplierId: string) {
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
        createdAt: true,
        products: {
          where: { status: "ACTIVE" },
          include: {
            category: true,
            supplier: true,
            inventory: true,
          },
          orderBy: { createdAt: "desc" },
          take: 60,
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException("Shop not found");
    }

    return {
      ...supplier,
      products: await this.reviewsService.attachSummaries(supplier.products),
    };
  }

  async getProduct(id: string) {    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
    });

    // The public detail endpoint must never leak unpublished listings
    // (suppliers view their own drafts via GET /supplier/products).
    if (!product || product.status !== "ACTIVE") {
      throw new NotFoundException("Product not found");
    }

    const [detailed] = await this.reviewsService.attachSummaries([product]);
    return detailed;
  }

  async getSupplierProducts(userId: string) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    return this.prisma.product.findMany({
      where: {
        supplierId: supplier.id,
      },
      include: {
        category: true,
        inventory: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    // The category drives every marketplace filter, so a listing may only
    // land in a real platform category (the FK alone would surface as an
    // opaque 500 on a well-formed but unknown UUID).
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException("Unknown category");
    }

    return this.prisma.product.create({
      data: {
        supplierId: supplier.id,
        categoryId: dto.categoryId,
        name: dto.name,
        slug: dto.slug,
        sku: dto.sku,
        description: dto.description,
        price: dto.price,
        unit: dto.unit,
        imageUrl: dto.imageUrl,
        // CP16a: derive the managed public_id from our own Cloudinary URL
        // server-side; external URLs store no publicId (nothing to destroy).
        imagePublicId: this.mediaService.derivePublicId(dto.imageUrl),
        status: dto.status ?? "DRAFT",
        inventory: {
          create: {
            quantity: dto.quantity ?? 0,
            lowStockLevel: dto.lowStockLevel ?? 10,
          },
        },
      },
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
    });
  }


  async getSupplierInventory(userId: string) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    const products = await this.prisma.product.findMany({
      where: {
        supplierId: supplier.id,
      },
      include: {
        inventory: true,
        category: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return products.map((product) => {
      const quantity = product.inventory?.quantity ?? 0;
      const reservedQuantity = product.inventory?.reservedQuantity ?? 0;

      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        unit: product.unit,
        status: product.status,
        category: product.category,
        inventoryId: product.inventory?.id ?? null,
        quantity,
        reservedQuantity,
        availableQuantity: Math.max(quantity - reservedQuantity, 0),
        lowStockLevel: product.inventory?.lowStockLevel ?? 0,
        isLowStock: quantity - reservedQuantity <= (product.inventory?.lowStockLevel ?? 0),
      };
    });
  }

  // CP15a: farm reference pin for checkpoint geo-plausibility flags.
  async updateSupplierPin(userId: string, dto: UpdateSupplierPinDto) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException("Supplier profile not found");
    }

    return this.prisma.supplierProfile.update({
      where: { id: profile.id },
      data: { lat: dto.lat, lng: dto.lng },
      select: { id: true, businessName: true, lat: true, lng: true },
    });
  }

  async updateSupplierInventory(
    userId: string,
    productId: string,
    dto: UpdateInventoryDto,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        supplier: {
          userId,
        },
      },
      include: {
        inventory: true,
      },
    });

    if (!product) {
      throw new NotFoundException("Supplier product not found");
    }

    if (!product.inventory) {
      throw new NotFoundException("Inventory record not found");
    }

    const reservedQuantity = product.inventory.reservedQuantity;

    if (
      dto.quantity !== undefined &&
      dto.quantity < reservedQuantity
    ) {
      throw new BadRequestException(
        `Quantity cannot be lower than reserved quantity (${reservedQuantity})`,
      );
    }

    const inventory = await this.prisma.inventory.update({
      where: {
        productId,
      },
      data: {
        ...(dto.quantity !== undefined
          ? { quantity: dto.quantity }
          : {}),
        ...(dto.lowStockLevel !== undefined
          ? { lowStockLevel: dto.lowStockLevel }
          : {}),
      },
    });

    return {
      productId,
      quantity: inventory.quantity,
      reservedQuantity: inventory.reservedQuantity,
      availableQuantity:
        inventory.quantity - inventory.reservedQuantity,
      lowStockLevel: inventory.lowStockLevel,
      isLowStock:
        inventory.quantity - inventory.reservedQuantity <=
        inventory.lowStockLevel,
    };
  }

  async updateProduct(id: string, userId: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        supplier: {
          userId,
        },
      },
      select: { id: true, imagePublicId: true },
    });

    if (!product) {
      throw new NotFoundException("Supplier product not found");
    }

    // CP16a: null clears the image; a changed URL swaps it. Only when the
    // image field is actually present in the payload (undefined = untouched).
    const { imageUrl, ...rest } = dto;
    const nextImagePublicId =
      imageUrl === undefined
        ? undefined
        : this.mediaService.derivePublicId(imageUrl);

    const updated = await this.prisma.product.update({
      where: { id },
      data:
        imageUrl === undefined
          ? rest
          : { ...rest, imageUrl, imagePublicId: nextImagePublicId },
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
    });

    // Destroy the replaced/cleared asset only after the row is safely updated
    // (best-effort — a Cloudinary hiccup must not fail the update).
    if (
      product.imagePublicId &&
      nextImagePublicId !== undefined &&
      nextImagePublicId !== product.imagePublicId
    ) {
      await this.mediaService.destroyAsset(product.imagePublicId);
    }

    return updated;
  }

  // CP16a: supplier storefront logo (the rest of the profile stays
  // admin-seeded until a real settings page exists).
  async updateSupplierProfile(userId: string, dto: UpdateSupplierProfileDto) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true, logoPublicId: true },
    });

    if (!profile) {
      throw new NotFoundException("Supplier profile not found");
    }

    const nextLogoPublicId =
      dto.logoUrl === undefined
        ? undefined
        : this.mediaService.derivePublicId(dto.logoUrl);

    const updated = await this.prisma.supplierProfile.update({
      where: { id: profile.id },
      data:
        dto.logoUrl === undefined
          ? {}
          : { logoUrl: dto.logoUrl, logoPublicId: nextLogoPublicId },
      select: {
        id: true,
        businessName: true,
        logoUrl: true,
        logoPublicId: true,
        verified: true,
        lat: true,
        lng: true,
      },
    });

    if (
      profile.logoPublicId &&
      nextLogoPublicId !== undefined &&
      nextLogoPublicId !== profile.logoPublicId
    ) {
      await this.mediaService.destroyAsset(profile.logoPublicId);
    }

    return updated;
  }
}
