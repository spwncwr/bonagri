import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { DisputesService } from "./disputes.service";

function makeService() {
  const prisma = {
    order: { findUnique: jest.fn() },
    dispute: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplierProfile: { findUnique: jest.fn() },
  };

  const mailService = {
    sendVerificationEmail: jest.fn(),
    sendDisputeResolutionEmail: jest.fn(),
  };

  return {
    service: new DisputesService(prisma as never, mailService as never),
    prisma,
    mailService,
  };
}

const buyerOrder = {
  id: "order-1",
  orderNumber: "BON-20261013-000001",
  userId: "buyer-1",
  status: "DELIVERED",
};

describe("DisputesService (CP5)", () => {
  describe("openDispute", () => {
    it("rejects non-buyer roles (vendors and admins cannot open disputes)", async () => {
      const { service } = makeService();

      await expect(
        service.openDispute("order-1", "vendor-1", "SUPPLIER", {
          reason: "DAMAGED",
          description: "Crates arrived broken",
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.openDispute("order-1", "admin-1", "ADMIN", {
          reason: "OTHER",
          description: "test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("hides orders that do not exist or belong to another buyer", async () => {
      const { service, prisma } = makeService();

      prisma.order.findUnique.mockResolvedValue(null);
      await expect(
        service.openDispute("order-x", "buyer-1", "BUYER", {
          reason: "DAMAGED",
          description: "broken",
        }),
      ).rejects.toThrow(NotFoundException);

      prisma.order.findUnique.mockResolvedValue({
        ...buyerOrder,
        userId: "someone-else",
      });
      await expect(
        service.openDispute("order-1", "buyer-1", "BUYER", {
          reason: "DAMAGED",
          description: "broken",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("only allows disputes from eligible statuses (out-for-delivery or delivered)", async () => {
      const { service, prisma } = makeService();

      for (const status of [
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "READY_FOR_DELIVERY",
        "CANCELLED",
      ]) {
        prisma.order.findUnique.mockResolvedValue({
          ...buyerOrder,
          status,
        });

        await expect(
          service.openDispute("order-1", "buyer-1", "BUYER", {
            reason: "NOT_DELIVERED",
            description: "where is it",
          }),
        ).rejects.toThrow(BadRequestException);
      }

      // Eligible statuses succeed.
      for (const status of ["OUT_FOR_DELIVERY", "DELIVERED"]) {
        prisma.order.findUnique.mockResolvedValue({
          ...buyerOrder,
          status,
        });
        prisma.dispute.findUnique.mockResolvedValue(null);
        prisma.dispute.create.mockResolvedValue({ id: "dispute-1" });

        await expect(
          service.openDispute("order-1", "buyer-1", "BUYER", {
            reason: "DAMAGED",
            description: "bruised tomatoes",
          }),
        ).resolves.toEqual({ id: "dispute-1" });
      }
    });

    it("rejects a duplicate dispute on an order that already has one", async () => {
      const { service, prisma } = makeService();

      prisma.order.findUnique.mockResolvedValue(buyerOrder);
      prisma.dispute.findUnique.mockResolvedValue({ id: "dispute-existing" });

      await expect(
        service.openDispute("order-1", "buyer-1", "BUYER", {
          reason: "DAMAGED",
          description: "again",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("maps a unique-constraint race on the order ref to 409", async () => {
      const { service, prisma } = makeService();

      prisma.order.findUnique.mockResolvedValue(buyerOrder);
      prisma.dispute.findUnique.mockResolvedValue(null);
      prisma.dispute.create.mockRejectedValue(
        new Error("Unique constraint failed on the fields: (`orderId`)"),
      );

      await expect(
        service.openDispute("order-1", "buyer-1", "BUYER", {
          reason: "OTHER",
          description: "race",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("getVendorDisputes", () => {
    it("requires a supplier profile and scopes to the vendor's products", async () => {
      const { service, prisma } = makeService();

      prisma.supplierProfile.findUnique.mockResolvedValue(null);
      await expect(service.getVendorDisputes("user-1")).rejects.toThrow(
        NotFoundException,
      );

      prisma.supplierProfile.findUnique.mockResolvedValue({ id: "sup-1" });
      prisma.dispute.findMany.mockResolvedValue([]);

      await expect(service.getVendorDisputes("user-1")).resolves.toEqual([]);

      expect(prisma.dispute.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            order: {
              items: {
                some: {
                  product: {
                    supplierId: "sup-1",
                  },
                },
              },
            },
          },
        }),
      );
    });
  });

  describe("resolveDispute", () => {
    const openDispute = {
      id: "dispute-1",
      status: "OPEN",
      order: {
        orderNumber: "BON-20261013-000001",
        user: { id: "buyer-1", email: "buyer@example.com", firstName: "Thandi" },
      },
    };

    it("rejects unknown disputes", async () => {
      const { service, prisma } = makeService();

      prisma.dispute.findUnique.mockResolvedValue(null);
      await expect(
        service.resolveDispute("missing", "admin-1", {
          status: "RESOLVED",
          resolutionNote: "refund issued",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("resolves an open dispute with a note, stamps the resolver, and emails the buyer", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.dispute.findUnique.mockResolvedValue(openDispute);
      prisma.dispute.update.mockResolvedValue({
        id: "dispute-1",
        status: "RESOLVED",
        resolutionNote: "refund issued",
      });
      mailService.sendDisputeResolutionEmail.mockResolvedValue(undefined);

      const result = await service.resolveDispute("dispute-1", "admin-1", {
        status: "RESOLVED",
        resolutionNote: "refund issued",
      });

      expect(result.dispute.status).toBe("RESOLVED");
      expect(result.emailSent).toBe(true);
      expect(prisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "RESOLVED",
            resolutionNote: "refund issued",
            resolvedById: "admin-1",
            resolvedAt: expect.any(Date),
          }),
        }),
      );
      expect(mailService.sendDisputeResolutionEmail).toHaveBeenCalledWith(
        "buyer@example.com",
        "Thandi",
        "BON-20261013-000001",
        "RESOLVED",
        "refund issued",
      );
    });

    it("moves an open dispute to under review without closing it, and sends no email", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.dispute.findUnique.mockResolvedValue(openDispute);
      prisma.dispute.update.mockResolvedValue({
        id: "dispute-1",
        status: "UNDER_REVIEW",
      });

      const result = await service.resolveDispute("dispute-1", "admin-1", {
        status: "UNDER_REVIEW",
      });

      expect(result.dispute.status).toBe("UNDER_REVIEW");
      expect(result.emailSent).toBe(false);
      expect(mailService.sendDisputeResolutionEmail).not.toHaveBeenCalled();
      expect(prisma.dispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolvedById: null,
            resolvedAt: null,
          }),
        }),
      );
    });

    it("rejects a transition from under review back to under review", async () => {
      const { service, prisma } = makeService();

      prisma.dispute.findUnique.mockResolvedValue({
        ...openDispute,
        status: "UNDER_REVIEW",
      });

      await expect(
        service.resolveDispute("dispute-1", "admin-1", {
          status: "UNDER_REVIEW",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("requires a resolution note when closing a dispute", async () => {
      const { service, prisma } = makeService();

      prisma.dispute.findUnique.mockResolvedValue(openDispute);

      await expect(
        service.resolveDispute("dispute-1", "admin-1", {
          status: "RESOLVED",
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.resolveDispute("dispute-1", "admin-1", {
          status: "REJECTED",
          resolutionNote: "   ",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.dispute.update).not.toHaveBeenCalled();
    });

    it("rejects any transition once the dispute is closed", async () => {
      const { service, prisma } = makeService();

      for (const status of ["RESOLVED", "REJECTED"]) {
        prisma.dispute.findUnique.mockResolvedValue({
          ...openDispute,
          status,
        });

        await expect(
          service.resolveDispute("dispute-1", "admin-1", {
            status: "RESOLVED",
            resolutionNote: "tried again",
          }),
        ).rejects.toThrow(BadRequestException);
      }

      expect(prisma.dispute.update).not.toHaveBeenCalled();
    });

    it("still returns the closed dispute when the resolution email fails", async () => {
      const { service, prisma, mailService } = makeService();

      prisma.dispute.findUnique.mockResolvedValue(openDispute);
      prisma.dispute.update.mockResolvedValue({
        id: "dispute-1",
        status: "REJECTED",
        resolutionNote: "delivered as ordered",
      });
      mailService.sendDisputeResolutionEmail.mockRejectedValue(
        new Error("SMTP down"),
      );

      const result = await service.resolveDispute("dispute-1", "admin-1", {
        status: "REJECTED",
        resolutionNote: "delivered as ordered",
      });

      expect(result.dispute.status).toBe("REJECTED");
      expect(result.emailSent).toBe(false);
    });
  });
});
