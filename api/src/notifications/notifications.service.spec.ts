import { NotFoundException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn() },
    orderItem: { findMany: jest.fn() },
    notification: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };

  const mailService = {
    sendNotificationEmail: jest.fn(),
  };

  return {
    service: new NotificationsService(prisma as never, mailService as never),
    prisma,
    mailService,
  };
}

const buyer = { id: "buyer-1", email: "thandi@example.com", firstName: "Thandi" };
const vendor = { id: "vendor-user-1", email: "sello@example.com", firstName: "Sello" };

describe("NotificationsService (CP6 glue)", () => {
  describe("onOrderStatusChanged", () => {
    it("notifies the buyer on CONFIRMED with a row and an email", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      mailService.sendNotificationEmail.mockResolvedValue(undefined);

      await service.onOrderStatusChanged({
        id: "order-1",
        orderNumber: "BON-1",
        status: "CONFIRMED",
        userId: "buyer-1",
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "buyer-1",
          title: "Order BON-1 confirmed",
          message: expect.stringContaining("confirmed your order"),
        },
      });
      expect(mailService.sendNotificationEmail).toHaveBeenCalledWith(
        "thandi@example.com",
        "Thandi",
        "Order BON-1 confirmed",
        expect.stringContaining("confirmed your order"),
      );
    });

    it("notifies the buyer on DELIVERED", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      mailService.sendNotificationEmail.mockResolvedValue(undefined);

      await service.onOrderStatusChanged({
        id: "order-1",
        orderNumber: "BON-1",
        status: "DELIVERED",
        userId: "buyer-1",
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "buyer-1",
            title: "Order BON-1 delivered",
          }),
        }),
      );
    });

    it("notifies the vendor (not the buyer) on CANCELLED", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique
        .mockResolvedValueOnce(buyer)
        .mockResolvedValueOnce(vendor);
      prisma.orderItem.findMany.mockResolvedValue([
        { product: { supplier: { userId: "vendor-user-1" } } },
      ]);
      mailService.sendNotificationEmail.mockResolvedValue(undefined);

      await service.onOrderStatusChanged({
        id: "order-1",
        orderNumber: "BON-1",
        status: "CANCELLED",
        userId: "buyer-1",
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "vendor-user-1",
            title: "Order BON-1 cancelled",
          }),
        }),
      );
    });

    it("writes no row for unconfigured transitions", async () => {
      const { service, prisma } = makeService();

      for (const status of ["PROCESSING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "PENDING"]) {
        await service.onOrderStatusChanged({
          id: "order-1",
          orderNumber: "BON-1",
          status,
          userId: "buyer-1",
        });
      }

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("skips silently when the buyer record is missing", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.onOrderStatusChanged({
          id: "order-1",
          orderNumber: "BON-1",
          status: "CONFIRMED",
          userId: "ghost",
        }),
      ).resolves.toBeUndefined();

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("skips silently when a cancelled order has no resolvable vendor", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.onOrderStatusChanged({
        id: "order-1",
        orderNumber: "BON-1",
        status: "CANCELLED",
        userId: "buyer-1",
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("still writes the row and never throws when the email fails", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      mailService.sendNotificationEmail.mockRejectedValue(new Error("SMTP down"));

      await expect(
        service.onOrderStatusChanged({
          id: "order-1",
          orderNumber: "BON-1",
          status: "CONFIRMED",
          userId: "buyer-1",
        }),
      ).resolves.toBeUndefined();

      expect(prisma.notification.create).toHaveBeenCalled();
    });
  });

  describe("onDisputeClosed", () => {
    it("records a row for the buyer without a second email (CP5 already emailed)", async () => {
      const { service, prisma, mailService } = makeService();

      await service.onDisputeClosed("BON-1", buyer, "RESOLVED");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "buyer-1",
          title: "Dispute on order BON-1 resolved",
          message: expect.stringContaining("resolved your dispute"),
        },
      });
      expect(mailService.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it("uses rejected wording for REJECTED outcomes", async () => {
      const { service, prisma } = makeService();

      await service.onDisputeClosed("BON-1", buyer, "REJECTED");

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Dispute on order BON-1 rejected",
          }),
        }),
      );
    });
  });

  describe("onSellerApplicationDecided", () => {
    it("notifies the applicant on approval", async () => {
      const { service, prisma, mailService } = makeService();

      mailService.sendNotificationEmail.mockResolvedValue(undefined);

      await service.onSellerApplicationDecided(buyer, "Thandi Fresh Produce", "APPROVED");

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "buyer-1",
            title: expect.stringContaining("approved"),
          }),
        }),
      );
      expect(mailService.sendNotificationEmail).toHaveBeenCalled();
    });

    it("notifies the applicant on rejection", async () => {
      const { service, prisma } = makeService();

      await service.onSellerApplicationDecided(buyer, "Thandi Fresh Produce", "REJECTED");

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining("not approved"),
          }),
        }),
      );
    });
  });

  describe("onSupplierVerified", () => {
    it("tells the vendor their store is verified", async () => {
      const { service, prisma, mailService } = makeService();

      mailService.sendNotificationEmail.mockResolvedValue(undefined);

      await service.onSupplierVerified(vendor, "Limpopo Fresh");

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "vendor-user-1",
            title: expect.stringContaining("verified"),
          }),
        }),
      );
      expect(mailService.sendNotificationEmail).toHaveBeenCalled();
    });
  });

  describe("inbox", () => {
    it("lists only the caller's notifications, newest first", async () => {
      const { service, prisma } = makeService();

      prisma.notification.findMany.mockResolvedValue([]);

      await expect(service.getMyNotifications("buyer-1")).resolves.toEqual([]);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "buyer-1" },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      );
    });

    it("markRead refuses other users' notifications", async () => {
      const { service, prisma } = makeService();

      prisma.notification.findUnique.mockResolvedValue({
        id: "n-1",
        userId: "someone-else",
      });

      await expect(service.markRead("n-1", "buyer-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it("markRead flips read for the owner", async () => {
      const { service, prisma } = makeService();

      prisma.notification.findUnique.mockResolvedValue({
        id: "n-1",
        userId: "buyer-1",
      });
      prisma.notification.update.mockResolvedValue({ id: "n-1", read: true });

      await expect(service.markRead("n-1", "buyer-1")).resolves.toEqual({
        id: "n-1",
        read: true,
      });
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "n-1" },
        data: { read: true },
      });
    });
  });
});
