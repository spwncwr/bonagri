import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";
import { VerificationService } from "../verification/verification.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { PromoteSupplierDto } from "./dto/promote-supplier.dto";
import { PromoteTransporterDto } from "./dto/promote-transporter.dto";
import { UpdateSupplierVerifyDto } from "./dto/update-supplier-verify.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { BroadcastNotificationDto } from "./dto/broadcast-notification.dto";
import { CreateBannerDto } from "./dto/create-banner.dto";
import { UpdateBannerDto } from "./dto/update-banner.dto";

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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly mediaService: MediaService,
    private readonly mailService: MailService,
    private readonly verificationService: VerificationService,
  ) {}

  async getUsers(query: ListUsersQueryDto) {
    return this.prisma.user.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  firstName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  lastName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  email: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        supplierProfile: {
          select: {
            id: true,
            businessName: true,
            verified: true,
          },
        },
        transporterProfile: {
          select: {
            id: true,
            businessName: true,
            verified: true,
          },
        },
        _count: {
          select: {
            orders: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async updateUserStatus(userId: string, dto: UpdateUserStatusDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role === "ADMIN" && dto.status === "SUSPENDED") {
      throw new BadRequestException(
        "Admin accounts cannot be suspended",
      );
    }

    if (user.status === dto.status) {
      return this.prisma.user.findUnique({
        where: { id: userId },
        select: this.userSummarySelect(),
      });
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
      select: this.userSummarySelect(),
    });
  }

  async promoteToSupplier(userId: string, dto: PromoteSupplierDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        supplierProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role === "ADMIN") {
      throw new BadRequestException(
        "Admin accounts cannot become suppliers",
      );
    }

    if (user.supplierProfile) {
      throw new ConflictException(
        "User already has a supplier profile",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.supplierProfile.create({
          data: {
            userId,
            businessName: dto.businessName.trim(),
            description: dto.description?.trim(),
            phone: dto.phone?.trim(),
            email: user.email,
            city: dto.city?.trim(),
            province: dto.province?.trim(),
            verified: false,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "User already has a supplier profile",
          );
        }

        throw error;
      }

      return tx.user.update({
        where: { id: userId },
        data: { role: "SUPPLIER" },
        select: this.userSummarySelect(),
      });
    });
  }

  async setSupplierVerified(
    supplierId: string,
    dto: UpdateSupplierVerifyDto,
    adminUserId: string,
  ) {
    const profile = await this.prisma.supplierProfile.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        user: { select: { id: true, email: true, firstName: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException("Supplier profile not found");
    }

    const updated = await this.prisma.supplierProfile.update({
      where: { id: supplierId },
      data: { verified: dto.verified },
      select: {
        id: true,
        businessName: true,
        verified: true,
        user: {
          select: { id: true, email: true },
        },
      },
    });

    // CP17: this legacy toggle is no longer the badge's only writer — the
    // centralised summary (User.businessStatus + latest application) is
    // synced through the verification service so the two can never disagree.
    try {
      await this.verificationService.syncLegacyBadge(
        profile.user.id,
        dto.verified,
        adminUserId,
      );
    } catch (error) {
      console.error("BonAgri verification summary sync failed:", error);
    }

    // Verification is granted only here (CP6): tell the vendor.
    if (dto.verified) {
      try {
        await this.notificationsService.onSupplierVerified(
          profile.user,
          updated.businessName,
        );
      } catch (error) {
        console.error("BonAgri verification notification failed:", error);
      }
    }

    return updated;
  }

  async getSupplierProfiles() {
    return this.prisma.supplierProfile.findMany({
      select: {
        id: true,
        businessName: true,
        description: true,
        city: true,
        province: true,
        phone: true,
        email: true,
        verified: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, status: true },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    const slug = dto.slug?.trim() || slugify(dto.name);
    const imageUrl = dto.imageUrl?.trim() || null;
    const imagePublicId = this.mediaService.derivePublicId(imageUrl);

    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim(),
          imageUrl,
          imagePublicId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "A category with this name or slug already exists",
        );
      }

      throw error;
    }
  }

  async updateCategory(categoryId: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException("Category not found");
    }

    const nextImagePublicId =
      dto.imageUrl !== undefined
        ? this.mediaService.derivePublicId(dto.imageUrl)
        : undefined;

    try {
      const updated = await this.prisma.category.update({
        where: { id: categoryId },
        data: {
          ...(dto.name !== undefined
            ? { name: dto.name.trim() }
            : {}),
          ...(dto.slug !== undefined
            ? { slug: dto.slug.trim() }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() }
            : {}),
          ...(dto.imageUrl !== undefined
            ? {
                imageUrl: dto.imageUrl?.trim() || null,
                imagePublicId: nextImagePublicId,
              }
            : {}),
        },
      });

      if (
        dto.imageUrl !== undefined &&
        existing.imagePublicId &&
        nextImagePublicId !== existing.imagePublicId
      ) {
        await this.mediaService.destroyAsset(existing.imagePublicId);
      }

      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "A category with this name or slug already exists",
        );
      }

      throw error;
    }
  }

  async getStats() {
    const [
      usersByRole,
      suspendedUsers,
      productsByStatus,
      ordersByStatus,
      revenue,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ["role"],
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { status: "SUSPENDED" } }),
      this.prisma.product.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
        where: { status: { not: "CANCELLED" } },
      }),
      this.prisma.order.aggregate({
        _sum: { total: true },
      }),
    ]);

    const countFor = (
      rows: Array<{ role?: string; status?: string; _count: { _all: number } }>,
      key: string,
    ) => rows.find((row) => (row.role ?? row.status) === key)?._count._all ?? 0;

    const users = {
      total: usersByRole.reduce((sum, row) => sum + row._count._all, 0),
      buyers: countFor(usersByRole, "BUYER"),
      suppliers: countFor(usersByRole, "SUPPLIER"),
      dealers: countFor(usersByRole, "AGRO_DEALER"),
      transporters: countFor(usersByRole, "TRANSPORTER"),
      admins: countFor(usersByRole, "ADMIN"),
      suspended: suspendedUsers,
    };

    const products = {
      total: productsByStatus.reduce(
        (sum, row) => sum + row._count._all,
        0,
      ),
      active: countFor(productsByStatus, "ACTIVE"),
      draft: countFor(productsByStatus, "DRAFT"),
      inactive: countFor(productsByStatus, "INACTIVE"),
    };

    const orders = {
      total: ordersByStatus.reduce(
        (sum, row) => sum + row._count._all,
        0,
      ),
      pending: countFor(ordersByStatus, "PENDING"),
      confirmed: countFor(ordersByStatus, "CONFIRMED"),
      processing: countFor(ordersByStatus, "PROCESSING"),
      readyForDelivery: countFor(ordersByStatus, "READY_FOR_DELIVERY"),
      outForDelivery: countFor(ordersByStatus, "OUT_FOR_DELIVERY"),
      delivered: countFor(ordersByStatus, "DELIVERED"),
      cancelled: countFor(ordersByStatus, "CANCELLED"),
    };

    return {
      users,
      products,
      orders,
      revenue: {
        net: revenue._sum.total ?? 0,
        gross: totalRevenue._sum.total ?? 0,
      },
    };
  }

  private userSummarySelect() {
    return {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
      supplierProfile: {
        select: {
          id: true,
          businessName: true,
          verified: true,
        },
      },
      transporterProfile: {
        select: {
          id: true,
          businessName: true,
          verified: true,
        },
      },
    } as const;
  }

  // CP14: admin promotes a user to TRANSPORTER, creating the profile
  // exactly once (mirrors promoteToSupplier). No self-serve path.
  async promoteToTransporter(userId: string, dto: PromoteTransporterDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        transporterProfile: { select: { id: true } },
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role === "ADMIN") {
      throw new BadRequestException(
        "Admin accounts cannot become transporters",
      );
    }

    if (user.transporterProfile) {
      throw new ConflictException(
        "User already has a transporter profile",
      );
    }

    const serviceProvinces = Array.from(
      new Set(dto.serviceProvinces.map((province) => province.trim())),
    ).filter(Boolean);

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.transporterProfile.create({
          data: {
            userId,
            businessName: dto.businessName.trim(),
            vehicleType: dto.vehicleType?.trim(),
            phone: dto.phone?.trim(),
            email: user.email,
            city: dto.city?.trim(),
            province: dto.province?.trim(),
            serviceProvinces,
            verified: false,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "User already has a transporter profile",
          );
        }

        throw error;
      }

      return tx.user.update({
        where: { id: userId },
        data: { role: "TRANSPORTER" },
        select: this.userSummarySelect(),
      });
    });
  }

  async listTransporters(verified?: boolean) {
    return this.prisma.transporterProfile.findMany({
      where: verified === undefined ? {} : { verified },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async setTransporterVerified(
    transporterId: string,
    dto: UpdateSupplierVerifyDto,
  ) {
    const profile = await this.prisma.transporterProfile.findUnique({
      where: { id: transporterId },
      select: {
        id: true,
        user: { select: { id: true, email: true, firstName: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException("Transporter profile not found");
    }

    const updated = await this.prisma.transporterProfile.update({
      where: { id: transporterId },
      data: { verified: dto.verified },
      select: {
        id: true,
        businessName: true,
        verified: true,
        user: { select: { id: true, email: true } },
      },
    });

    // Verified transporters can see and claim jobs — tell them.
    if (dto.verified) {
      try {
        await this.notificationsService.onTransporterVerified(
          profile.user,
          updated.businessName,
        );
      } catch (error) {
        console.error("BonAgri verification notification failed:", error);
      }
    }

    return updated;
  }

  // Broadcast notifications
  async getAudienceCounts() {
    const counts = await this.prisma.user.groupBy({
      by: ["role"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    });

    const get = (role: string) =>
      counts.find((c) => c.role === role)?._count._all ?? 0;

    const buyer = get("BUYER");
    const supplier = get("SUPPLIER");
    const agroDealer = get("AGRO_DEALER");
    const transporter = get("TRANSPORTER");
    const admin = get("ADMIN");

    return {
      all: buyer + supplier + agroDealer + transporter + admin,
      buyer,
      supplier,
      agroDealer,
      transporter,
      admin,
    };
  }

  async broadcastNotification(
    adminUserId: string,
    dto: BroadcastNotificationDto,
  ) {
    const roleFilter =
      dto.targetRole === "ALL"
        ? {}
        : { role: dto.targetRole as "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "TRANSPORTER" };

    const recipients = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        ...roleFilter,
      },
      select: { id: true, email: true, firstName: true },
    });

    if (recipients.length > 0) {
      await this.prisma.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          title: dto.title.trim(),
          message: dto.message.trim(),
        })),
      });

      if (dto.sendEmail) {
        for (const recipient of recipients) {
          try {
            await this.mailService.sendNotificationEmail(
              recipient.email,
              recipient.firstName,
              dto.title.trim(),
              dto.message.trim(),
            );
          } catch (error) {
            console.error("Broadcast email delivery error:", recipient.email, error);
          }
        }
      }
    }

    return this.prisma.notificationBroadcast.create({
      data: {
        title: dto.title.trim(),
        message: dto.message.trim(),
        targetRole: dto.targetRole,
        recipientCount: recipients.length,
        sentEmail: Boolean(dto.sendEmail),
        createdById: adminUserId,
      },
    });
  }

  async listBroadcasts() {
    return this.prisma.notificationBroadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  // Promo Banners
  async listBanners(onlyActive = false) {
    return this.prisma.promoBanner.findMany({
      where: onlyActive ? { isActive: true } : {},
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  async createBanner(dto: CreateBannerDto) {
    const imageUrl = dto.imageUrl?.trim() || null;
    const imagePublicId = this.mediaService.derivePublicId(imageUrl);

    return this.prisma.promoBanner.create({
      data: {
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim() || null,
        eyebrow: dto.eyebrow?.trim() || null,
        ctaText: dto.ctaText?.trim() || "Learn more",
        ctaLink: dto.ctaLink?.trim() || "/explore",
        imageUrl,
        imagePublicId,
        tone: dto.tone?.trim() || "from-[#17633a] to-[#0c3f23]",
        targetRole: dto.targetRole?.trim() || "ALL",
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateBanner(bannerId: string, dto: UpdateBannerDto) {
    const existing = await this.prisma.promoBanner.findUnique({
      where: { id: bannerId },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException("Banner not found");
    }

    const nextImagePublicId =
      dto.imageUrl !== undefined
        ? this.mediaService.derivePublicId(dto.imageUrl)
        : undefined;

    const updated = await this.prisma.promoBanner.update({
      where: { id: bannerId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.subtitle !== undefined
          ? { subtitle: dto.subtitle.trim() || null }
          : {}),
        ...(dto.eyebrow !== undefined
          ? { eyebrow: dto.eyebrow.trim() || null }
          : {}),
        ...(dto.ctaText !== undefined
          ? { ctaText: dto.ctaText.trim() || "Learn more" }
          : {}),
        ...(dto.ctaLink !== undefined
          ? { ctaLink: dto.ctaLink.trim() || "/explore" }
          : {}),
        ...(dto.imageUrl !== undefined
          ? {
              imageUrl: dto.imageUrl?.trim() || null,
              imagePublicId: nextImagePublicId,
            }
          : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone.trim() } : {}),
        ...(dto.targetRole !== undefined
          ? { targetRole: dto.targetRole.trim() }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    if (
      dto.imageUrl !== undefined &&
      existing.imagePublicId &&
      nextImagePublicId !== existing.imagePublicId
    ) {
      await this.mediaService.destroyAsset(existing.imagePublicId);
    }

    return updated;
  }

  async deleteBanner(bannerId: string) {
    const existing = await this.prisma.promoBanner.findUnique({
      where: { id: bannerId },
      select: { id: true, imagePublicId: true },
    });

    if (!existing) {
      throw new NotFoundException("Banner not found");
    }

    await this.prisma.promoBanner.delete({
      where: { id: bannerId },
    });

    if (existing.imagePublicId) {
      await this.mediaService.destroyAsset(existing.imagePublicId);
    }

    return { success: true };
  }
}
