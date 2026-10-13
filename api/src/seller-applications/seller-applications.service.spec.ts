import { ConflictException, NotFoundException } from "@nestjs/common";
import { SellerApplicationsService } from "./seller-applications.service";

function makeService() {
  const tx = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    supplierProfile: { create: jest.fn() },
    sellerApplication: { update: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) =>
      callback(tx),
    ),
    user: { findUnique: jest.fn() },
    sellerApplication: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplierProfile: { create: jest.fn() },
  };

  const notifications = {
    onSellerApplicationDecided: jest.fn(),
  };

  return {
    service: new SellerApplicationsService(
      prisma as never,
      notifications as never,
    ),
    prisma,
    tx,
    notifications,
  };
}

const application = {
  id: "app-1",
  userId: "buyer-1",
  desiredRole: "SUPPLIER",
  businessName: "Thandi Fresh Produce",
  status: "PENDING",
  user: { id: "buyer-1", email: "thandi@example.com", firstName: "Thandi", role: "BUYER" },
};

const freshBuyer = {
  id: "buyer-1",
  role: "BUYER",
  supplierProfile: null,
};

describe("SellerApplicationsService (CP6 self-service)", () => {
  describe("apply", () => {
    it("creates a PENDING application for an eligible buyer", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(freshBuyer);
      prisma.sellerApplication.findUnique.mockResolvedValue(null);
      prisma.sellerApplication.create.mockResolvedValue({ id: "app-1" });

      await expect(
        service.apply("buyer-1", {
          desiredRole: "AGRO_DEALER",
          businessName: "  Thandi Tools  ",
          message: "I want to sell fencing gear",
        }),
      ).resolves.toEqual({ id: "app-1" });

      expect(prisma.sellerApplication.create).toHaveBeenCalledWith({
        data: {
          userId: "buyer-1",
          desiredRole: "AGRO_DEALER",
          businessName: "Thandi Tools",
          message: "I want to sell fencing gear",
        },
      });
    });

    it("rejects accounts that already sell (role or profile)", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...freshBuyer,
        supplierProfile: { id: "sup-1" },
      });
      await expect(
        service.apply("buyer-1", { desiredRole: "SUPPLIER", businessName: "X" }),
      ).rejects.toThrow(ConflictException);

      prisma.user.findUnique.mockResolvedValue({
        ...freshBuyer,
        role: "SUPPLIER",
      });
      await expect(
        service.apply("buyer-1", { desiredRole: "SUPPLIER", businessName: "X" }),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a second pending application and any approved one", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(freshBuyer);

      prisma.sellerApplication.findUnique.mockResolvedValue({
        ...application,
        status: "PENDING",
      });
      await expect(
        service.apply("buyer-1", { desiredRole: "SUPPLIER", businessName: "X" }),
      ).rejects.toThrow(ConflictException);

      prisma.sellerApplication.findUnique.mockResolvedValue({
        ...application,
        status: "APPROVED",
      });
      await expect(
        service.apply("buyer-1", { desiredRole: "SUPPLIER", businessName: "X" }),
      ).rejects.toThrow(ConflictException);
    });

    it("reopens a previously rejected application instead of duplicating it", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(freshBuyer);
      prisma.sellerApplication.findUnique.mockResolvedValue({
        ...application,
        status: "REJECTED",
        reviewedById: "admin-1",
        reviewNote: "not yet",
        reviewedAt: new Date(),
      });
      prisma.sellerApplication.update.mockResolvedValue({ id: "app-1" });

      await expect(
        service.apply("buyer-1", {
          desiredRole: "SUPPLIER",
          businessName: "Thandi Fresh Produce v2",
        }),
      ).resolves.toEqual({ id: "app-1" });

      expect(prisma.sellerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "buyer-1" },
          data: expect.objectContaining({
            status: "PENDING",
            businessName: "Thandi Fresh Produce v2",
            reviewedById: null,
            reviewNote: null,
            reviewedAt: null,
          }),
        }),
      );
      expect(prisma.sellerApplication.create).not.toHaveBeenCalled();
    });

    it("maps a creation race on the unique userId to 409", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(freshBuyer);
      prisma.sellerApplication.findUnique.mockResolvedValue(null);
      prisma.sellerApplication.create.mockRejectedValue(
        new Error("Unique constraint failed on the fields: (`userId`)"),
      );

      await expect(
        service.apply("buyer-1", { desiredRole: "SUPPLIER", businessName: "X" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("decide", () => {
    it("rejects unknown and already-reviewed applications", async () => {
      const { service, prisma } = makeService();

      prisma.sellerApplication.findUnique.mockResolvedValue(null);
      await expect(
        service.decide("missing", "admin-1", { status: "APPROVED" }),
      ).rejects.toThrow(NotFoundException);

      for (const status of ["APPROVED", "REJECTED"]) {
        prisma.sellerApplication.findUnique.mockResolvedValue({
          ...application,
          status,
        });
        await expect(
          service.decide("app-1", "admin-1", { status: "REJECTED" }),
        ).rejects.toThrow(ConflictException);
      }

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("approval promotes the role exactly once: profile + role + stamp in one transaction", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.sellerApplication.findUnique
        .mockResolvedValueOnce(application)
        .mockResolvedValueOnce({ ...application, status: "APPROVED" });
      tx.user.findUnique.mockResolvedValue({ role: "BUYER", supplierProfile: null });
      tx.supplierProfile.create.mockResolvedValue({ id: "sup-1" });
      tx.user.update.mockResolvedValue({ id: "buyer-1", role: "SUPPLIER" });
      tx.sellerApplication.update.mockResolvedValue({ id: "app-1" });
      notifications.onSellerApplicationDecided.mockResolvedValue(undefined);

      await service.decide("app-1", "admin-1", {
        status: "APPROVED",
        note: "welcome aboard",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.supplierProfile.create).toHaveBeenCalledTimes(1);
      expect(tx.supplierProfile.create).toHaveBeenCalledWith({
        data: {
          userId: "buyer-1",
          businessName: "Thandi Fresh Produce",
          email: "thandi@example.com",
          verified: false,
        },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: "buyer-1" },
        data: { role: "SUPPLIER" },
      });
      expect(tx.sellerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "APPROVED",
            reviewedById: "admin-1",
            reviewNote: "welcome aboard",
            reviewedAt: expect.any(Date),
          }),
        }),
      );
      expect(notifications.onSellerApplicationDecided).toHaveBeenCalledWith(
        application.user,
        "Thandi Fresh Produce",
        "APPROVED",
      );
    });

    it("refuses to promote when the account is no longer an eligible buyer", async () => {
      const { service, prisma, tx } = makeService();

      prisma.sellerApplication.findUnique.mockResolvedValue(application);
      tx.user.findUnique.mockResolvedValue({ role: "SUPPLIER", supplierProfile: null });

      await expect(
        service.decide("app-1", "admin-1", { status: "APPROVED" }),
      ).rejects.toThrow(ConflictException);

      expect(tx.supplierProfile.create).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("maps a profile-creation race to 409 (no double promotion)", async () => {
      const { service, prisma, tx } = makeService();

      prisma.sellerApplication.findUnique.mockResolvedValue(application);
      tx.user.findUnique.mockResolvedValue({ role: "BUYER", supplierProfile: null });
      tx.supplierProfile.create.mockRejectedValue(
        new Error("Unique constraint failed on the fields: (`userId`)"),
      );

      await expect(
        service.decide("app-1", "admin-1", { status: "APPROVED" }),
      ).rejects.toThrow(ConflictException);

      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("rejection stamps the review and touches no role or profile", async () => {
      const { service, prisma, notifications } = makeService();

      prisma.sellerApplication.findUnique
        .mockResolvedValueOnce(application)
        .mockResolvedValueOnce({ ...application, status: "REJECTED" });
      prisma.sellerApplication.update.mockResolvedValue({ id: "app-1" });
      notifications.onSellerApplicationDecided.mockResolvedValue(undefined);

      await service.decide("app-1", "admin-1", {
        status: "REJECTED",
        note: "missing registration documents",
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.sellerApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "REJECTED",
            reviewNote: "missing registration documents",
          }),
        }),
      );
      expect(notifications.onSellerApplicationDecided).toHaveBeenCalledWith(
        application.user,
        "Thandi Fresh Produce",
        "REJECTED",
      );
    });

    it("returns the decided application even if the applicant notification fails", async () => {
      const { service, prisma, notifications } = makeService();

      prisma.sellerApplication.findUnique
        .mockResolvedValueOnce(application)
        .mockResolvedValueOnce({ ...application, status: "REJECTED" });
      prisma.sellerApplication.update.mockResolvedValue({ id: "app-1" });
      notifications.onSellerApplicationDecided.mockRejectedValue(
        new Error("SMTP down"),
      );

      await expect(
        service.decide("app-1", "admin-1", { status: "REJECTED" }),
      ).resolves.toEqual({ ...application, status: "REJECTED" });
    });
  });
});
