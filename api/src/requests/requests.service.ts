import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateProductRequestDto } from "./dto/create-product-request.dto";
import { UpdateProductRequestDto } from "./dto/update-product-request.dto";
import { CreateRequestResponseDto } from "./dto/create-request-response.dto";
import { UpdateRequestResponseDto } from "./dto/update-request-response.dto";

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
        // Landing badge: how many suppliers are interested (count only).
        _count: {
          select: {
            responses: { where: { status: { in: ["OPEN", "ACCEPTED"] } } },
          },
        },
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

  async respond(
    requestId: string,
    userId: string,
    dto: CreateRequestResponseDto,
  ) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException("No supplier profile for this account");
    }

    const request = await this.prisma.productRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true },
    });

    if (!request) {
      throw new NotFoundException("Product request not found");
    }

    if (request.status !== "OPEN") {
      throw new ConflictException(
        `Request is already ${request.status.toLowerCase()}`,
      );
    }

    const duplicate = await this.prisma.requestResponse.findUnique({
      where: {
        requestId_supplierId: { requestId, supplierId: profile.id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException("You already responded to this request");
    }

    return this.prisma.requestResponse.create({
      data: {
        requestId,
        supplierId: profile.id,
        message: dto.message.trim(),
        quotedPrice: dto.quotedPrice ?? null,
        quotedUnit: dto.quotedUnit?.trim() || null,
      },
      select: {
        id: true,
        status: true,
        message: true,
        quotedPrice: true,
        quotedUnit: true,
        createdAt: true,
      },
    });
  }

  // Buyer-owner reads responses to their own request; foreign ids 404 alike.
  async listResponses(requestId: string, userId: string) {
    const request = await this.prisma.productRequest.findUnique({
      where: { id: requestId },
      select: { id: true, buyerId: true },
    });

    if (!request || request.buyerId !== userId) {
      throw new NotFoundException("Product request not found");
    }

    return this.prisma.requestResponse.findMany({
      where: { requestId },
      select: {
        id: true,
        message: true,
        quotedPrice: true,
        quotedUnit: true,
        status: true,
        createdAt: true,
        supplier: {
          select: {
            businessName: true,
            city: true,
            verified: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async listMyResponses(userId: string) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException("No supplier profile for this account");
    }

    return this.prisma.requestResponse.findMany({
      where: { supplierId: profile.id },
      select: {
        id: true,
        status: true,
        message: true,
        quotedPrice: true,
        quotedUnit: true,
        createdAt: true,
        request: {
          select: {
            id: true,
            title: true,
            quantity: true,
            unit: true,
            destinationCity: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async updateResponse(
    responseId: string,
    userId: string,
    dto: UpdateRequestResponseDto,
  ) {
    const response = await this.prisma.requestResponse.findUnique({
      where: { id: responseId },
      select: {
        id: true,
        status: true,
        requestId: true,
        supplier: {
          select: {
            userId: true,
            businessName: true,
            user: {
              select: { id: true, email: true, firstName: true },
            },
          },
        },
        request: {
          select: { id: true, title: true, buyerId: true },
        },
      },
    });

    // Withdraw = vendor-only; accept/decline = buyer-owner-only; both 404
    // for anyone else so ids cannot be probed.
    const isVendorWithdraw =
      dto.status === "WITHDRAWN" && response?.supplier.userId === userId;
    const isBuyerDecision =
      (dto.status === "ACCEPTED" || dto.status === "DECLINED") &&
      response?.request.buyerId === userId;

    if (!response || (!isVendorWithdraw && !isBuyerDecision)) {
      throw new NotFoundException("Response not found");
    }

    if (response.status !== "OPEN") {
      throw new ConflictException(
        `Response is already ${response.status.toLowerCase()}`,
      );
    }

    if (dto.status === "ACCEPTED") {
      // Accepting wins the request: every other live response closes.
      const [, updated] = await this.prisma.$transaction([
        this.prisma.requestResponse.updateMany({
          where: {
            requestId: response.requestId,
            status: "OPEN",
            id: { not: responseId },
          },
          data: { status: "DECLINED" },
        }),
        this.prisma.requestResponse.update({
          where: { id: responseId },
          data: { status: "ACCEPTED" },
        }),
      ]);

      // The decision is committed; telling the vendor is best-effort.
      try {
        await this.notificationsService.onRequestResponseAccepted(
          response.supplier.user,
          response.request.title,
        );
      } catch (error) {
        console.error("BonAgri request-response notification failed:", error);
      }

      return updated;
    }

    return this.prisma.requestResponse.update({
      where: { id: responseId },
      data: { status: dto.status },
    });
  }
}
