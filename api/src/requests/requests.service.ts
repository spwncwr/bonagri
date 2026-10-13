import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductRequestDto } from "./dto/create-product-request.dto";
import { UpdateProductRequestDto } from "./dto/update-product-request.dto";

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(buyerId: string, dto: CreateProductRequestDto) {
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true },
      });

      if (!category) {
        throw new BadRequestException("Category not found");
      }
    }

    if (dto.requiredBy) {
      const requiredBy = new Date(dto.requiredBy);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (requiredBy < startOfToday) {
        throw new BadRequestException(
          "requiredBy cannot be in the past",
        );
      }
    }

    return this.prisma.productRequest.create({
      data: {
        buyerId,
        title: dto.title.trim(),
        categoryId: dto.categoryId ?? null,
        quantity: dto.quantity,
        unit: dto.unit.trim(),
        destinationCity: dto.destinationCity?.trim() || null,
        requiredBy: dto.requiredBy ? new Date(dto.requiredBy) : null,
        notes: dto.notes?.trim() || null,
      },
      include: {
        category: { select: { name: true, slug: true } },
      },
    });
  }

  // Public demand board: OPEN requests only, newest first. Explicit
  // select - never expose buyerId or any buyer identity here (Prisma
  // scalars like buyerId leak unless excluded).
  async listOpen() {
    return this.prisma.productRequest.findMany({
      where: { status: "OPEN" },
      select: {
        id: true,
        title: true,
        quantity: true,
        unit: true,
        destinationCity: true,
        requiredBy: true,
        notes: true,
        createdAt: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async getMine(userId: string) {
    return this.prisma.productRequest.findMany({
      where: { buyerId: userId },
      include: {
        category: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateProductRequestDto,
  ) {
    const request = await this.prisma.productRequest.findUnique({
      where: { id },
      select: { id: true, buyerId: true, status: true },
    });

    // Foreign requests 404 so ids cannot be probed.
    if (!request || request.buyerId !== userId) {
      throw new NotFoundException("Product request not found");
    }

    if (request.status !== "OPEN") {
      throw new ConflictException(
        `Request is already ${request.status.toLowerCase()}`,
      );
    }

    return this.prisma.productRequest.update({
      where: { id },
      data: { status: dto.status },
      include: {
        category: { select: { name: true, slug: true } },
      },
    });
  }
}
