import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateSellerApplicationDto } from "./dto/create-seller-application.dto";
import { ReviewSellerApplicationDto } from "./dto/review-seller-application.dto";

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
export class SellerApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async apply(userId: string, dto: CreateSellerApplicationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        supplierProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role !== "BUYER" || user.supplierProfile) {
      throw new ConflictException(
        "This account already sells on BonAgri",
      );
    }

    const existing = await this.prisma.sellerApplication.findUnique({
      where: { userId },
    });

    if (existing?.status === "PENDING") {
      throw new ConflictException(
        "You already have a pending application",
      );
    }

    if (existing?.status === "APPROVED") {
      throw new ConflictException(
        "Your application was already approved",
      );
    }

    // A previously rejected applicant may apply again: the same
    // record is reopened (userId is unique - one lifecycle per user).
    if (existing) {
      return this.prisma.sellerApplication.update({
        where: { userId },
        data: {
          desiredRole: dto.desiredRole,
          businessName: dto.businessName.trim(),
          message: dto.message?.trim(),
          status: "PENDING",
          reviewedById: null,
          reviewNote: null,
          reviewedAt: null,
        },
      });
    }

    try {
      return await this.prisma.sellerApplication.create({
        data: {
          userId,
          desiredRole: dto.desiredRole,
          businessName: dto.businessName.trim(),
          message: dto.message?.trim(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "You already have a pending application",
        );
      }

      throw error;
    }
  }

  async getMine(userId: string) {
    return this.prisma.sellerApplication.findUnique({
      where: { userId },
    });
  }

  async getQueue() {
    return this.prisma.sellerApplication.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        reviewedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async decide(
    applicationId: string,
    adminUserId: string,
    dto: ReviewSellerApplicationDto,
  ) {
    const application = await this.prisma.sellerApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            role: true,
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundException("Seller application not found");
    }

    if (application.status !== "PENDING") {
      throw new ConflictException(
        "This application has already been reviewed",
      );
    }

    const note = dto.note?.trim() ?? null;

    if (dto.status === "APPROVED") {
      // Promotion happens exactly once: the eligibility re-check and
      // the profile creation live in the same transaction.
      try {
        await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: application.userId },
            select: {
              role: true,
              supplierProfile: { select: { id: true } },
            },
          });

          if (!user || user.role !== "BUYER" || user.supplierProfile) {
            throw new ConflictException(
              "This account is no longer an eligible buyer",
            );
          }

          await tx.supplierProfile.create({
            data: {
              userId: application.userId,
              businessName: application.businessName,
              email: application.user.email,
              verified: false,
            },
          });

          await tx.user.update({
            where: { id: application.userId },
            data: { role: application.desiredRole },
          });

          await tx.sellerApplication.update({
            where: { id: applicationId },
            data: {
              status: "APPROVED",
              reviewedById: adminUserId,
              reviewNote: note,
              reviewedAt: new Date(),
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "This account is no longer an eligible buyer",
          );
        }

        throw error;
      }
    } else {
      await this.prisma.sellerApplication.update({
        where: { id: applicationId },
        data: {
          status: "REJECTED",
          reviewedById: adminUserId,
          reviewNote: note,
          reviewedAt: new Date(),
        },
      });
    }

    // The decision is committed; notifying the applicant is best-effort.
    try {
      await this.notificationsService.onSellerApplicationDecided(
        application.user,
        application.businessName,
        dto.status,
      );
    } catch (error) {
      console.error("BonAgri seller application notification failed:", error);
    }

    return this.prisma.sellerApplication.findUnique({
      where: { id: applicationId },
      include: {
        reviewedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }
}
