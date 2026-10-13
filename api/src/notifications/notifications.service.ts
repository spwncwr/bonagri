import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";

type OrderTransitionTarget = {
  id: string;
  orderNumber: string;
  status: string;
  userId: string;
};

type Recipient = {
  id: string;
  email: string;
  firstName: string;
};

// Configured CP6 transitions: who gets told about what.
const ORDER_NOTIFICATION_CONFIG: Record<
  string,
  {
    recipient: "buyer" | "vendor";
    title: (orderNumber: string) => string;
    message: (orderNumber: string) => string;
  }
> = {
  CONFIRMED: {
    recipient: "buyer",
    title: (orderNumber) => `Order ${orderNumber} confirmed`,
    message: () =>
      "The supplier confirmed your order and is preparing it. You can follow every step on the order page.",
  },
  DELIVERED: {
    recipient: "buyer",
    title: (orderNumber) => `Order ${orderNumber} delivered`,
    message: () =>
      "Your order has been delivered. Check everything arrived in good shape - if not, you can open a dispute from the order page.",
  },
  CANCELLED: {
    recipient: "vendor",
    title: (orderNumber) => `Order ${orderNumber} cancelled`,
    message: () =>
      "The buyer cancelled this order. The reserved stock has been released back to your inventory.",
  },
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async onOrderStatusChanged(order: OrderTransitionTarget) {
    const config = ORDER_NOTIFICATION_CONFIG[order.status];

    if (!config) {
      return;
    }

    const buyer = await this.prisma.user.findUnique({
      where: { id: order.userId },
      select: { id: true, email: true, firstName: true },
    });

    if (!buyer) {
      return;
    }

    let recipient: Recipient = buyer;

    if (config.recipient === "vendor") {
      const vendorUserId = await this.resolveVendorUserId(order.id);

      if (!vendorUserId) {
        return;
      }

      const vendor = await this.prisma.user.findUnique({
        where: { id: vendorUserId },
        select: { id: true, email: true, firstName: true },
      });

      if (!vendor) {
        return;
      }

      recipient = vendor;
    }

    await this.deliver(
      recipient,
      config.title(order.orderNumber),
      config.message(order.orderNumber),
    );
  }

  async onDisputeClosed(
    orderNumber: string,
    buyer: { id: string; email: string; firstName: string },
    outcome: "RESOLVED" | "REJECTED",
  ) {
    // The dedicated resolution email already went out (CP5);
    // this hook records the in-app notification row.
    await this.prisma.notification.create({
      data: {
        userId: buyer.id,
        title: `Dispute on order ${orderNumber} ${
          outcome === "RESOLVED" ? "resolved" : "rejected"
        }`,
        message:
          outcome === "RESOLVED"
            ? "The BonAgri team resolved your dispute in your favour. The resolution note is on the order page."
            : "The BonAgri team reviewed your dispute and rejected it. The resolution note is on the order page.",
      },
    });
  }

  async onSellerApplicationDecided(
    applicant: { id: string; email: string; firstName: string },
    businessName: string,
    status: "APPROVED" | "REJECTED",
  ) {
    const approved = status === "APPROVED";

    const title = approved
      ? "Your BonAgri seller application was approved"
      : "Your BonAgri seller application was not approved";

    const message = approved
      ? `${businessName} is now live as a vendor. Log in to reach your vendor hub, list products and manage orders.`
      : `Unfortunately the BonAgri team could not approve the ${businessName} application at this time. You are welcome to apply again.`;

    await this.deliver(applicant, title, message);
  }

  async onSupplierVerified(
    vendor: { id: string; email: string; firstName: string },
    businessName: string,
  ) {
    await this.deliver(
      vendor,
      "Your BonAgri store is verified",
      `${businessName} now carries the BonAgri verified badge. Buyers see it on every listing.`,
    );
  }

  async getMyNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { id: true, userId: true },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException("Notification not found");
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  // The row write must never break the triggering action; the email is
  // best-effort for the same reason (house pattern from CP5).
  private async deliver(
    recipient: Recipient,
    title: string,
    message: string,
  ) {
    try {
      await this.prisma.notification.create({
        data: {
          userId: recipient.id,
          title,
          message,
        },
      });
    } catch (error) {
      console.error("BonAgri notification row write failed:", error);
      return;
    }

    try {
      await this.mailService.sendNotificationEmail(
        recipient.email,
        recipient.firstName,
        title,
        message,
      );
    } catch (error) {
      console.error("BonAgri notification email failed:", error);
    }
  }

  private async resolveVendorUserId(orderId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: {
        product: {
          select: {
            supplier: {
              select: { userId: true },
            },
          },
        },
      },
    });

    return items[0]?.product?.supplier?.userId ?? null;
  }
}
