import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TransportService } from "./transport.service";

type PrismaMock = {
  transporterProfile: { findUnique: jest.Mock; findMany: jest.Mock };
  delivery: { findMany: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
};

function makePrisma(): PrismaMock {
  return {
    transporterProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    delivery: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function makeService(prisma: PrismaMock) {
  const notifications = {
    onDeliveryClaimed: jest.fn(),
  };

  return {
    service: new TransportService(prisma as never, notifications as never),
    notifications,
  };
}

function primeVerifiedProfile(prisma: PrismaMock) {
  prisma.transporterProfile.findUnique.mockResolvedValue({
    id: "tp-1",
    businessName: "Bela Bela Hauliers",
    verified: true,
    serviceProvinces: ["Limpopo"],
  });
}

describe("TransportService (CP14)", () => {
  describe("getJobs", () => {
    it("filters the board by the transporter's service provinces", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findMany.mockResolvedValue([]);

      await service.getJobs("tp-user-1");

      expect(prisma.delivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            transporterId: null,
            publishedAt: { not: null },
          }),
        }),
      );
    });

    it("projects jobs to city level only", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findMany.mockResolvedValue([
        {
          orderId: "order-1",
          publishedAt: new Date("2026-10-19T09:00:00Z"),
          order: {
            orderNumber: "BON-20261019-111111",
            createdAt: new Date(),
            items: [
              {
                quantity: 4,
                product: {
                  supplier: { businessName: "Polokwane Fresh", city: "Polokwane" },
                },
              },
            ],
            deliveryAddress: { city: "Tzaneen", province: "Limpopo" },
          },
        },
      ]);

      const jobs = await service.getJobs("tp-user-1");

      expect(jobs).toEqual([
        expect.objectContaining({
          orderId: "order-1",
          orderNumber: "BON-20261019-111111",
          pickupCity: "Polokwane",
          dropoffCity: "Tzaneen",
          itemCount: 4,
        }),
      ]);
      // The full address object must never leave the board endpoint.
      expect(JSON.stringify(jobs)).not.toContain("deliveryAddress");
    });

    it("blocks unverified transporters (403)", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      prisma.transporterProfile.findUnique.mockResolvedValue({
        id: "tp-1",
        businessName: "New Haulier",
        verified: false,
        serviceProvinces: ["Limpopo"],
      });

      await expect(service.getJobs("tp-user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("claimJob", () => {
    it("claims atomically via a conditional update", async () => {
      const prisma = makePrisma();
      const { service, notifications } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findUnique.mockResolvedValue({
        orderId: "order-1",
        status: "PENDING",
        transporterId: null,
        order: { id: "order-1", orderNumber: "BON-1" },
      });
      prisma.delivery.updateMany.mockResolvedValue({ count: 1 });

      await service.claimJob("order-1", "tp-user-1");

      expect(prisma.delivery.updateMany).toHaveBeenCalledWith({
        where: {
          orderId: "order-1",
          status: "PENDING",
          transporterId: null,
          publishedAt: { not: null },
        },
        data: { status: "ASSIGNED", transporterId: "tp-1" },
      });
      expect(notifications.onDeliveryClaimed).toHaveBeenCalledWith(
        { id: "order-1", orderNumber: "BON-1" },
        "Bela Bela Hauliers",
      );
    });

    it("returns 409 to the losing concurrent claim", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findUnique.mockResolvedValueOnce({
        orderId: "order-1",
        status: "PENDING",
        transporterId: null,
        order: { id: "order-1", orderNumber: "BON-1" },
      });
      prisma.delivery.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claimJob("order-1", "tp-user-1")).rejects.toThrow(
        ConflictException,
      );
    });

    it("returns 409 when the caller already claimed the job", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findUnique.mockResolvedValue({
        orderId: "order-1",
        status: "ASSIGNED",
        transporterId: "tp-1",
        order: { id: "order-1", orderNumber: "BON-1" },
      });

      await expect(service.claimJob("order-1", "tp-user-1")).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    });

    it("404s on an unknown job", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      primeVerifiedProfile(prisma);
      prisma.delivery.findUnique.mockResolvedValue(null);

      await expect(service.claimJob("missing", "tp-user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("blocks unverified transporters (403)", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      prisma.transporterProfile.findUnique.mockResolvedValue({
        id: "tp-1",
        verified: false,
        serviceProvinces: [],
      });

      await expect(service.claimJob("order-1", "tp-user-1")).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.delivery.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("getMyDeliveries", () => {
    it("splits active jobs from history", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      prisma.transporterProfile.findUnique.mockResolvedValue({
        id: "tp-1",
        businessName: "Bela Bela Hauliers",
        verified: true,
        serviceProvinces: ["Limpopo"],
      });
      prisma.delivery.findMany.mockResolvedValue([
        { orderId: "o-1", status: "PICKED_UP", order: {} },
        { orderId: "o-2", status: "DELIVERED", order: {} },
        { orderId: "o-3", status: "FAILED", order: {} },
        { orderId: "o-4", status: "ASSIGNED", order: {} },
      ]);

      const result = await service.getMyDeliveries("tp-user-1");

      expect(result.active.map((d) => d.orderId)).toEqual(["o-1", "o-4"]);
      expect(result.history.map((d) => d.orderId)).toEqual(["o-2", "o-3"]);
      // The query is scoped to this transporter's profile.
      expect(prisma.delivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { transporterId: "tp-1" },
        }),
      );
    });

    it("lets an unverified transporter see (an empty) history", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      prisma.transporterProfile.findUnique.mockResolvedValue({
        id: "tp-1",
        businessName: "New Haulier",
        verified: false,
        serviceProvinces: [],
      });
      prisma.delivery.findMany.mockResolvedValue([]);

      const result = await service.getMyDeliveries("tp-user-1");

      expect(result).toEqual({ active: [], history: [] });
    });

    it("404s for a user without a transporter profile", async () => {
      const prisma = makePrisma();
      const { service } = makeService(prisma);

      prisma.transporterProfile.findUnique.mockResolvedValue(null);

      await expect(service.getMyDeliveries("buyer-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
