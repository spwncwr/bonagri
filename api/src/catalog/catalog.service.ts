import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

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
