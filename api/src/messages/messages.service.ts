import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { UserRole } from "../common/types";
import { SendMessageDto } from "./dto/send-message.dto";

export type MessageActor = {
  id: string;
  role: UserRole;
};

// Resolved once per request: the order's number, every participant's user id
// (for ping fan-out), whether the caller is a read-only observer (admin),
// and the caller's display name for their own outgoing rows.
type ThreadAccess = {
  orderNumber: string;
  participantIds: Set<string>;
  readOnly: boolean;
  senderName: string;
};

// F2: order-scoped messaging — one thread per order, polling-only MVP.
// The participant matrix mirrors orders.service getOrderDetail/getDelivery:
// buyer owns the order, supplier owns an order item, transporter is the
// assigned delivery driver; admin is read-only. Every foreign caller gets
// the SAME flat 404 "Order not found" so thread existence never leaks.
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listMessages(orderId: string, actor: MessageActor) {
    const access = await this.resolveAccess(orderId, actor);

    // Latest 200 messages, returned oldest-first (readable thread order).
    const messages = await this.prisma.orderMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        body: true,
        createdAt: true,
        senderId: true,
      },
    });

    const names = await this.resolveDisplayNames(
      messages.map((message) => message.senderId),
    );

    return {
      orderNumber: access.orderNumber,
      readOnly: access.readOnly,
      unreadCount: await this.countUnread(orderId, actor.id),
      messages: messages
        .slice()
        .reverse()
        .map((message) => ({
          id: message.id,
          body: message.body,
          createdAt: message.createdAt,
          senderId: message.senderId,
          senderName: names[message.senderId] ?? "Unknown",
          isOwn: message.senderId === actor.id,
        })),
    };
  }

  async sendMessage(orderId: string, actor: MessageActor, dto: SendMessageDto) {
    const access = await this.resolveAccess(orderId, actor);

    // Admin read-only (plan §F2): route roles already exclude ADMIN, this is
    // the defence in depth if that ever changes.
    if (access.readOnly) {
      throw new ForbiddenException(
        "Administrators have read-only access to order threads",
      );
    }

    // The DTO rejects "", but whitespace-only bodies slip past IsNotEmpty.
    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException("Message body cannot be empty");
    }

    const message = await this.prisma.orderMessage.create({
      data: { orderId, senderId: actor.id, body },
      select: { id: true, body: true, createdAt: true, senderId: true },
    });

    // The sender has seen their own message — advance their read cursor so
    // their own badge never counts it.
    await this.prisma.orderThreadRead.upsert({
      where: { orderId_userId: { orderId, userId: actor.id } },
      create: { orderId, userId: actor.id },
      update: { lastReadAt: new Date() },
    });

    // Ping every OTHER participant — in-app Notification rows only (a chat
    // thread must not email people per message; the bell + unread badge are
    // the affordance). Best-effort: never fails the send (house pattern).
    const recipients = [...access.participantIds].filter(
      (userId) => userId !== actor.id,
    );
    await this.notifications.onOrderMessage(
      recipients,
      access.orderNumber,
      access.senderName,
      body,
    );

    return {
      id: message.id,
      body: message.body,
      createdAt: message.createdAt,
      senderId: message.senderId,
      senderName: access.senderName,
      isOwn: true,
    };
  }

  async markRead(orderId: string, actor: MessageActor) {
    await this.resolveAccess(orderId, actor);

    const lastReadAt = new Date();
    await this.prisma.orderThreadRead.upsert({
      where: { orderId_userId: { orderId, userId: actor.id } },
      create: { orderId, userId: actor.id, lastReadAt },
      update: { lastReadAt },
    });

    return { unreadCount: 0 };
  }

  // Bulk badge feed for the order LISTS (buyer orders, supplier orders,
  // transport hub): one request instead of one poll per visible card.
  // Bounded: the participant's 100 newest orders, 500 newest messages.
  async unreadCounts(actor: MessageActor) {
    // Read-only observers get no badge affordance.
    if (actor.role === "ADMIN") {
      return { counts: {} as Record<string, number> };
    }

    const conditions: Prisma.OrderWhereInput[] = [];

    if (actor.role === "BUYER") {
      conditions.push({ userId: actor.id });
    }

    if (actor.role === "SUPPLIER" || actor.role === "AGRO_DEALER") {
      const supplier = await this.prisma.supplierProfile.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (supplier) {
        conditions.push({
          items: { some: { product: { supplierId: supplier.id } } },
        });
      }
    }

    if (actor.role === "TRANSPORTER") {
      const profile = await this.prisma.transporterProfile.findUnique({
        where: { userId: actor.id },
        select: { id: true },
      });
      if (profile) {
        conditions.push({ delivery: { transporterId: profile.id } });
      }
    }

    if (conditions.length === 0) {
      return { counts: {} as Record<string, number> };
    }

    const orders = await this.prisma.order.findMany({
      where: { OR: conditions },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const orderIds = orders.map((order) => order.id);

    if (orderIds.length === 0) {
      return { counts: {} as Record<string, number> };
    }

    const reads = await this.prisma.orderThreadRead.findMany({
      where: { orderId: { in: orderIds }, userId: actor.id },
      select: { orderId: true, lastReadAt: true },
    });
    const cutoffs = new Map(
      reads.map((read) => [read.orderId, read.lastReadAt.getTime()]),
    );

    // Only messages newer than the oldest cursor can be unread anywhere;
    // count them per order against each order's own cursor.
    const oldestCutoff = cutoffs.size > 0 ? Math.min(...cutoffs.values()) : 0;
    const recent = await this.prisma.orderMessage.findMany({
      where: {
        orderId: { in: orderIds },
        createdAt: { gt: new Date(oldestCutoff) },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { orderId: true, createdAt: true },
    });

    const counts: Record<string, number> = {};
    for (const message of recent) {
      const cutoff = cutoffs.get(message.orderId) ?? 0;
      if (message.createdAt.getTime() > cutoff) {
        counts[message.orderId] = (counts[message.orderId] ?? 0) + 1;
      }
    }

    return { counts };
  }

  // Flat 404 for every non-participant — existence of the order (and its
  // thread) must not leak to strangers, mirroring getOrderDetail.
  private async resolveAccess(
    orderId: string,
    actor: MessageActor,
  ): Promise<ThreadAccess> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        items: { select: { product: { select: { supplierId: true } } } },
        delivery: { select: { transporterId: true } },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (actor.role === "ADMIN") {
      return {
        orderNumber: order.orderNumber,
        participantIds: new Set(),
        readOnly: true,
        senderName: "",
      };
    }

    const participantIds = new Set<string>([order.userId]);

    const supplierIds = [
      ...new Set(order.items.map((item) => item.product.supplierId)),
    ];
    if (supplierIds.length > 0) {
      const suppliers = await this.prisma.supplierProfile.findMany({
        where: { id: { in: supplierIds } },
        select: { userId: true },
      });
      for (const supplier of suppliers) {
        participantIds.add(supplier.userId);
      }
    }

    if (order.delivery?.transporterId) {
      const transporter = await this.prisma.transporterProfile.findUnique({
        where: { id: order.delivery.transporterId },
        select: { userId: true },
      });
      if (transporter) {
        participantIds.add(transporter.userId);
      }
    }

    if (!participantIds.has(actor.id)) {
      throw new NotFoundException("Order not found");
    }

    return {
      orderNumber: order.orderNumber,
      participantIds,
      readOnly: false,
      senderName: (await this.resolveDisplayNames([actor.id]))[actor.id] ??
        "Someone",
    };
  }

  private async countUnread(orderId: string, userId: string) {
    const read = await this.prisma.orderThreadRead.findUnique({
      where: { orderId_userId: { orderId, userId } },
      select: { lastReadAt: true },
    });
    const cutoff = read?.lastReadAt ?? new Date(0);

    return this.prisma.orderMessage.count({
      where: { orderId, createdAt: { gt: cutoff } },
    });
  }

  // Display names: plain user names for buyers/admins, the business name for
  // supplier and transporter senders (what the counterparties actually see).
  private async resolveDisplayNames(
    userIds: string[],
  ): Promise<Record<string, string>> {
    const unique = [...new Set(userIds)];

    if (unique.length === 0) {
      return {};
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    const supplierUserIds = users
      .filter(
        (user) => user.role === "SUPPLIER" || user.role === "AGRO_DEALER",
      )
      .map((user) => user.id);
    const transporterUserIds = users
      .filter((user) => user.role === "TRANSPORTER")
      .map((user) => user.id);

    const [supplierProfiles, transporterProfiles] = await Promise.all([
      supplierUserIds.length > 0
        ? this.prisma.supplierProfile.findMany({
            where: { userId: { in: supplierUserIds } },
            select: { userId: true, businessName: true },
          })
        : Promise.resolve([]),
      transporterUserIds.length > 0
        ? this.prisma.transporterProfile.findMany({
            where: { userId: { in: transporterUserIds } },
            select: { userId: true, businessName: true },
          })
        : Promise.resolve([]),
    ]);

    const supplierNames = new Map(
      supplierProfiles.map((profile) => [
        profile.userId,
        profile.businessName,
      ]),
    );
    const transporterNames = new Map(
      transporterProfiles.map((profile) => [
        profile.userId,
        profile.businessName,
      ]),
    );

    const names: Record<string, string> = {};
    for (const user of users) {
      let name = `${user.firstName} ${user.lastName}`.trim();

      if (user.role === "SUPPLIER" || user.role === "AGRO_DEALER") {
        name = supplierNames.get(user.id) ?? name;
      } else if (user.role === "TRANSPORTER") {
        name = transporterNames.get(user.id) ?? name;
      }

      names[user.id] = name;
    }

    return names;
  }
}
