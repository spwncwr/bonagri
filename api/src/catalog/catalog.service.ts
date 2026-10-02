import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  async createProduct(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        supplierId: dto.supplierId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug: dto.slug,
        sku: dto.sku,
        description: dto.description,
        price: dto.price,
        unit: dto.unit,
        imageUrl: dto.imageUrl,
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

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.getProduct(id);

    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: {
        category: true,
        supplier: true,
        inventory: true,
      },
    });
  }
}
