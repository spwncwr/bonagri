import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { UserRole } from "../common/types";
import { OpenDisputeDto } from "./dto/open-dispute.dto";
import { ResolveDisputeDto } from "./dto/resolve-dispute.dto";

// A dispute can only be raised once the order is out for delivery or done.
const DISPUTE_ELIGIBLE_STATUSES = ["OUT_FOR_DELIVERY", "DELIVERED"];

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;

  if (code === "P2002") {
    return true;
  }

  const message =
    "message" in error
      ? String((error as { message?: unknown }).message)
      : "";

  return message.toLowerCase().includes("unique constraint");
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async openDispute(
    orderId: string,
    userId: string,
    role: UserRole,
    dto: OpenDisputeDto,
  ) {
    if (role !== "BUYER") {
      throw new BadRequestException("Only buyers can open disputes");
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        status: true,
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException("Order not found");
    }

    if (!DISPUTE_ELIGIBLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        `Disputes can only be opened on out-for-delivery or delivered orders (current status: ${order.status})`,
      );
    }

    const existing = await this.prisma.dispute.findUnique({
      where: { orderId },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException("A dispute already exists for this order");
    }

    try {
      return await this.prisma.dispute.create({
        data: {
          orderId,
          openedById: userId,
          reason: dto.reason,
          description: dto.description.trim(),
        },
        include: {
          order: {
            select: { id: true, orderNumber: true, status: true },
          },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("A dispute already exists for this order");
      }

      throw error;
    }
  }

  async getVendorDisputes(userId: string) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException("Supplier profile not found");
    }

    return this.prisma.dispute.findMany({
      where: {
        order: {
          items: {
            some: {
              product: {
                supplierId: supplier.id,
              },
            },
          },
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            createdAt: true,
          },
        },
        openedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getAdminDisputes() {
    return this.prisma.dispute.findMany({
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            subtotal: true,
            deliveryFee: true,
            total: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            items: true,
            // The evidence trail for the admin queue (D6).
            history: {
              orderBy: { createdAt: "asc" as const },
            },
          },
        },
        openedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        resolvedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async resolveDispute(
    disputeId: string,
    adminUserId: string,
    dto: ResolveDisputeDto,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        order: {
          select: {
            orderNumber: true,
            user: {
              select: { id: true, email: true, firstName: true },
            },
          },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundException("Dispute not found");
    }

    if (dispute.status === "RESOLVED" || dispute.status === "REJECTED") {
      throw new BadRequestException("Dispute is already closed");
    }

    const closing = dto.status === "RESOLVED" || dto.status === "REJECTED";

    if (closing && !dto.resolutionNote?.trim()) {
      throw new BadRequestException(
        "A resolution note is required when closing a dispute",
      );
    }

    if (dto.status === "UNDER_REVIEW" && dispute.status === "UNDER_REVIEW") {
      throw new BadRequestException("Dispute is already under review");
    }

    const note = dto.resolutionNote?.trim() ?? null;

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: dto.status,
        resolutionNote: note,
        resolvedById: closing ? adminUserId : null,
        resolvedAt: closing ? new Date() : null,
      },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
        openedBy: {
          select: { id: true, email: true, firstName: true },
        },
        resolvedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // The dispute state is already committed; the resolution email is
    // best-effort so an SMTP outage never blocks an admin decision.
    let emailSent = false;

    if (closing) {
      try {
        await this.mailService.sendDisputeResolutionEmail(
          dispute.order.user.email,
          dispute.order.user.firstName,
          dispute.order.orderNumber,
          dto.status as "RESOLVED" | "REJECTED",
          note,
        );
        emailSent = true;
      } catch (error) {
        console.error("BonAgri dispute resolution email failed:", error);
      }
    }

    return { dispute: updated, emailSent };
  }
}
