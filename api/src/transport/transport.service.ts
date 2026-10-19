import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class TransportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // The transporter's own profile; only verified transporters may see or
  // claim jobs (admin grants verification from the console).
  private async requireProfile(userId: string, requireVerified: boolean) {
    const profile = await this.prisma.transporterProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        businessName: true,
        verified: true,
        serviceProvinces: true,
      },
    });

    if (!profile) {
      throw new NotFoundException("Transporter profile not found");
    }

    if (requireVerified && !profile.verified) {
      throw new ForbiddenException(
        "Your transporter profile is not verified yet",
      );
    }

    return profile;
  }

  // CP14: the open job board. City-level only — the full delivery address
  // and buyer contact unlock once a job is claimed. Jobs whose delivery
  // address has no province are visible to every verified transporter
  // (there is nothing to filter on).
  async getJobs(userId: string) {
    const profile = await this.requireProfile(userId, true);

    const deliveries = await this.prisma.delivery.findMany({
      where: {
        status: "PENDING",
        transporterId: null,
        publishedAt: { not: null },
        order: {
          deliveryAddress: profile.serviceProvinces.length
            ? {
                OR: [
                  { province: { in: profile.serviceProvinces } },
                  { province: null },
                ],
              }
            : undefined,
          },
      },
      include: {
        order: {
          select: {
            orderNumber: true,
            createdAt: true,
            items: {
              select: {
                quantity: true,
                product: {
                  select: {
                    supplier: { select: { businessName: true, city: true } },
                  },
                },
              },
            },
            deliveryAddress: { select: { city: true, province: true } },
          },
        },
      },
      orderBy: { publishedAt: "asc" },
    });

    return deliveries.map((delivery) => {
      const itemCount = delivery.order.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      return {
        orderId: delivery.orderId,
        orderNumber: delivery.order.orderNumber,
        pickupCity: delivery.order.items[0]?.product?.supplier?.city ?? null,
        supplierBusinessName:
          delivery.order.items[0]?.product?.supplier?.businessName ?? null,
        dropoffCity: delivery.order.deliveryAddress.city,
        dropoffProvince: delivery.order.deliveryAddress.province,
        itemCount,
        publishedAt: delivery.publishedAt,
      };
    });
  }

  // Atomic first-claim: the conditional update is the lock, so a losing
  // concurrent claim gets count 0 → 409.
  async claimJob(orderId: string, userId: string) {
    const profile = await this.requireProfile(userId, true);

    const delivery = await this.prisma.delivery.findUnique({
      where: { orderId },
      select: {
        orderId: true,
        status: true,
        transporterId: true,
        order: { select: { id: true, orderNumber: true } },
      },
    });

    if (!delivery) {
      throw new NotFoundException("Delivery job not found");
    }

    if (delivery.transporterId === profile.id) {
      throw new ConflictException("You already claimed this delivery job");
    }

    const claimed = await this.prisma.delivery.updateMany({
      where: {
        orderId,
        status: "PENDING",
        transporterId: null,
        publishedAt: { not: null },
      },
      data: {
        status: "ASSIGNED",
        transporterId: profile.id,
      },
    });

    if (claimed.count !== 1) {
      throw new ConflictException(
        "This delivery job was just claimed by someone else",
      );
    }

    try {
      await this.notificationsService.onDeliveryClaimed(
        delivery.order,
        profile.businessName,
      );
    } catch (error) {
      console.error("BonAgri claim notification failed:", error);
    }

    return this.prisma.delivery.findUnique({
      where: { orderId },
      select: {
        orderId: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        order: { select: { orderNumber: true, status: true } },
      },
    });
  }

  // CP14: "my deliveries" — full pickup/dropoff details and buyer contact
  // are visible only here, and only for the claimed jobs.
  async getMyDeliveries(userId: string) {
    const profile = await this.requireProfile(userId, false);

    const deliveries = await this.prisma.delivery.findMany({
      where: { transporterId: profile.id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            createdAt: true,
            items: {
              select: {
                quantity: true,
                product: { select: { name: true } },
              },
            },
            deliveryAddress: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const activeStatuses = new Set(["ASSIGNED", "PICKED_UP", "IN_TRANSIT"]);

    const active = deliveries.filter((d) => activeStatuses.has(d.status));
    const history = deliveries.filter((d) => !activeStatuses.has(d.status));

    return { active, history };
  }
}
