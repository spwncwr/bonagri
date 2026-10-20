import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../media/media.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";
import { UpdateSupplierPinDto } from "./dto/update-supplier-pin.dto";
import { UpdateSupplierProfileDto } from "./dto/update-supplier-profile.dto";

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
  ) {}

  async getCategories() {
    return this.prisma.category.findMany({
      orderBy: { name: "asc" },
    });
  }

  async getProducts(search?: string, categorySlug?: string) {
    return this.prisma.product.findMany({
      where: {
        status: "ACTIVE",
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                {
                  supplier: {
                    businessName: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            }
          : {}),
        ...(categorySlug
          ? {
              category: {
                slug: categorySlug,
              },
            }
          : {}),
      },
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUnique({
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

    return product;
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
