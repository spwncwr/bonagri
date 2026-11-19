import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MessagesService, MessageActor } from "./messages.service";

type PrismaMock = {
  order: { findUnique: jest.Mock; findMany: jest.Mock };
  orderMessage: { findMany: jest.Mock; create: jest.Mock; count: jest.Mock };
  orderThreadRead: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  user: { findMany: jest.Mock };
  supplierProfile: { findUnique: jest.Mock; findMany: jest.Mock };
  transporterProfile: { findUnique: jest.Mock };
};

function makePrisma(): PrismaMock {
  return {
    order: { findUnique: jest.fn(), findMany: jest.fn() },
    orderMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    orderThreadRead: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findMany: jest.fn() },
    supplierProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    transporterProfile: { findUnique: jest.fn() },
  };
}

function makeService() {
  const prisma = makePrisma();
  const notifications = { onOrderMessage: jest.fn() };

  return {
    service: new MessagesService(prisma as never, notifications as never),
    prisma,
    notifications,
  };
}

// Order fixture: buyer-1 owns it, sup-1 owns the items, tp-1 is the
// assigned transporter — the three non-admin participants.
const ORDER = {
  id: "order-1",
  orderNumber: "BON-20261119-125105",
  userId: "buyer-1",
  items: [{ product: { supplierId: "sup-1" } }],
  delivery: { transporterId: "tp-1" },
};

const BUYER: MessageActor = { id: "buyer-1", role: "BUYER" };
const FOREIGN_BUYER: MessageActor = { id: "buyer-2", role: "BUYER" };
const OWNING_SUPPLIER: MessageActor = { id: "sup-user-1", role: "SUPPLIER" };
const OTHER_SUPPLIER: MessageActor = { id: "sup-user-2", role: "SUPPLIER" };
const TRANSPORTER: MessageActor = { id: "tp-user-1", role: "TRANSPORTER" };
const ADMIN: MessageActor = { id: "admin-1", role: "ADMIN" };

// Wire the shared lookups every happy path needs: participants (supplier +
// transporter profiles) and display names (plain user rows for the buyer).
function primeHappyPath(prisma: PrismaMock) {
  prisma.order.findUnique.mockResolvedValue(ORDER);
  prisma.supplierProfile.findMany.mockResolvedValue([
    { userId: "sup-user-1" },
  ]);
  prisma.transporterProfile.findUnique.mockResolvedValue({
    userId: "tp-user-1",
  });
  prisma.orderThreadRead.findUnique.mockResolvedValue(null);
  prisma.orderMessage.findMany.mockResolvedValue([]);
  prisma.orderMessage.count.mockResolvedValue(0);
  prisma.user.findMany.mockImplementation(
    ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        where.id.in.map((id) => ({
          id,
          firstName: "Test",
          lastName: id,
          role: id === "buyer-1" ? "BUYER" : "SUPPLIER",
        })),
      ),
  );
}

describe("MessagesService (F2)", () => {
  describe("participant matrix (read)", () => {
    it("lets the buyer read their own order's thread", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      const result = await service.listMessages("order-1", BUYER);

      expect(result.orderNumber).toBe("BON-20261119-125105");
      expect(result.readOnly).toBe(false);
      expect(result.messages).toEqual([]);
    });

    it("lets the owning supplier read the thread", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.listMessages("order-1", OWNING_SUPPLIER),
      ).resolves.toMatchObject({ readOnly: false });
    });

    it("lets the assigned transporter read the thread", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.listMessages("order-1", TRANSPORTER),
      ).resolves.toMatchObject({ readOnly: false });
    });

    it("lets an admin read any thread as a read-only observer", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      const result = await service.listMessages("order-1", ADMIN);

      expect(result.readOnly).toBe(true);
    });

    it("404s a foreign buyer without leaking the order", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.listMessages("order-1", FOREIGN_BUYER),
      ).rejects.toThrow(new NotFoundException("Order not found"));
    });

    it("404s a supplier who does not own any order item", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.listMessages("order-1", OTHER_SUPPLIER),
      ).rejects.toThrow(new NotFoundException("Order not found"));
    });

    it("404s a transporter who is not assigned to this delivery", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);
      // Same order, but someone else (or nobody) is behind the wheel.
      prisma.order.findUnique.mockResolvedValue({
        ...ORDER,
        delivery: { transporterId: "tp-2" },
      });
      prisma.transporterProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.listMessages("order-1", TRANSPORTER),
      ).rejects.toThrow(new NotFoundException("Order not found"));
    });

    it("404s when the order does not exist at all", async () => {
      const { service, prisma } = makeService();
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.listMessages("missing", BUYER),
      ).rejects.toThrow(new NotFoundException("Order not found"));
    });
  });

  describe("sendMessage", () => {
    it("stores the trimmed body, advances the sender cursor, pings the others", async () => {
      const { service, prisma, notifications } = makeService();
      primeHappyPath(prisma);
      prisma.orderMessage.create.mockResolvedValue({
        id: "msg-1",
        body: "Can you deliver Thursday?",
        createdAt: new Date("2026-11-19T10:00:00Z"),
        senderId: "buyer-1",
      });

      const result = await service.sendMessage("order-1", BUYER, {
        body: "  Can you deliver Thursday?  ",
      });

      expect(result.isOwn).toBe(true);
      expect(result.senderName).toBe("Test buyer-1");
      expect(prisma.orderMessage.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          senderId: "buyer-1",
          body: "Can you deliver Thursday?",
        },
        select: { id: true, body: true, createdAt: true, senderId: true },
      });
      expect(prisma.orderThreadRead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId_userId: { orderId: "order-1", userId: "buyer-1" },
          },
        }),
      );
      // Ping fan-out: every participant EXCEPT the sender (in-app rows only).
      expect(notifications.onOrderMessage).toHaveBeenCalledWith(
        expect.arrayContaining(["sup-user-1", "tp-user-1"]),
        "BON-20261119-125105",
        "Test buyer-1",
        "Can you deliver Thursday?",
      );
      const recipients = notifications.onOrderMessage.mock.calls[0][0];
      expect(recipients).toHaveLength(2);
      expect(recipients).not.toContain("buyer-1");
    });

    it("404s a foreign buyer before any write happens", async () => {
      const { service, prisma, notifications } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.sendMessage("order-1", FOREIGN_BUYER, { body: "hi" }),
      ).rejects.toThrow(new NotFoundException("Order not found"));

      expect(prisma.orderMessage.create).not.toHaveBeenCalled();
      expect(notifications.onOrderMessage).not.toHaveBeenCalled();
    });

    it("refuses an admin send (read-only defence in depth)", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.sendMessage("order-1", ADMIN, { body: "hi" }),
      ).rejects.toThrow(
        "Administrators have read-only access to order threads",
      );

      expect(prisma.orderMessage.create).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only body", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.sendMessage("order-1", BUYER, { body: "   " }),
      ).rejects.toThrow(new BadRequestException("Message body cannot be empty"));

      expect(prisma.orderMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("markRead + unread counts", () => {
    it("markRead upserts the cursor and reports zero unread", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.markRead("order-1", BUYER),
      ).resolves.toEqual({ unreadCount: 0 });

      expect(prisma.orderThreadRead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId_userId: { orderId: "order-1", userId: "buyer-1" },
          },
          update: { lastReadAt: expect.any(Date) },
        }),
      );
    });

    it("markRead 404s a foreign buyer", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);

      await expect(
        service.markRead("order-1", FOREIGN_BUYER),
      ).rejects.toThrow(new NotFoundException("Order not found"));

      expect(prisma.orderThreadRead.upsert).not.toHaveBeenCalled();
    });

    it("listMessages counts only messages newer than the read cursor", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);
      prisma.orderThreadRead.findUnique.mockResolvedValue({
        lastReadAt: new Date("2026-11-19T09:00:00Z"),
      });
      prisma.orderMessage.count.mockResolvedValue(3);

      const result = await service.listMessages("order-1", BUYER);

      expect(result.unreadCount).toBe(3);
      expect(prisma.orderMessage.count).toHaveBeenCalledWith({
        where: {
          orderId: "order-1",
          createdAt: { gt: new Date("2026-11-19T09:00:00Z") },
        },
      });
    });

    it("unreadCounts (bulk) counts per order against each cursor", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);
      prisma.order.findMany.mockResolvedValue([
        { id: "order-1" },
        { id: "order-2" },
      ]);
      const readAt = new Date("2026-11-19T09:00:00Z");
      prisma.orderThreadRead.findMany.mockResolvedValue([
        { orderId: "order-1", lastReadAt: readAt },
      ]);
      prisma.orderMessage.findMany.mockResolvedValue([
        // desc order as fetched; order-2 has no cursor row (cutoff 0).
        { orderId: "order-2", createdAt: new Date("2026-11-19T10:02:00Z") },
        { orderId: "order-2", createdAt: new Date("2026-11-19T10:01:00Z") },
        { orderId: "order-1", createdAt: new Date("2026-11-19T10:00:00Z") },
      ]);

      const { counts } = await service.unreadCounts(BUYER);

      expect(counts).toEqual({ "order-1": 1, "order-2": 2 });
      // Buyer candidates come from ownership, not the whole platform.
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ userId: "buyer-1" }] } }),
      );
    });

    it("unreadCounts scopes suppliers and transporters to their own orders", async () => {
      const { service, prisma } = makeService();
      primeHappyPath(prisma);
      prisma.order.findMany.mockResolvedValue([]);
      // unreadCounts looks the profiles up by user id (select id) — the
      // inverse of resolveAccess's by-id lookup (select userId).
      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.transporterProfile.findUnique.mockResolvedValue({ id: "tp-1" });

      await service.unreadCounts(OWNING_SUPPLIER);
      expect(prisma.order.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { items: { some: { product: { supplierId: "sup-1" } } } },
            ],
          },
        }),
      );

      await service.unreadCounts(TRANSPORTER);
      expect(prisma.order.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { OR: [{ delivery: { transporterId: "tp-1" } }] },
        }),
      );
    });

    it("unreadCounts returns an empty feed for admins (no badge)", async () => {
      const { service, prisma } = makeService();

      await expect(service.unreadCounts(ADMIN)).resolves.toEqual({
        counts: {},
      });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });
  });
});
