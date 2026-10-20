import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  CheckpointsService,
  computeCheckpointFlags,
  haversineKm,
} from "./checkpoints.service";

function makeService() {
  const prisma = {
    delivery: { findUnique: jest.fn() },
    transporterProfile: { findUnique: jest.fn() },
    deliveryCheckpoint: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  return {
    service: new CheckpointsService(prisma as never),
    prisma,
  };
}

// Polokwane-ish fixture: supplier farm pin and delivery address pin a few km
// apart — a checkpoint next to either pin stays under every distance flag.
function deliveryFixture(
  overrides: Partial<{ transporterId: string | null }> = {},
) {
  return {
    id: "del-1",
    transporterId: "tp-1" as string | null,
    order: {
      id: "ord-1",
      userId: "buyer-1",
      deliveryAddress: { id: "addr-1", lat: -23.9, lng: 29.46 },
      items: [
        {
          product: {
            supplierId: "sup-1",
            supplier: {
              id: "sup-1",
              userId: "supplier-1",
              lat: -23.88,
              lng: 29.45,
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

const transporterActor = { id: "tp-user-1", role: "TRANSPORTER" };
const supplierActor = { id: "supplier-1", role: "SUPPLIER" };

function primeAssignedTransporter(prisma: ReturnType<typeof makeService>["prisma"]) {
  prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
  prisma.transporterProfile.findUnique.mockResolvedValue({ id: "tp-1" });
  prisma.deliveryCheckpoint.findFirst.mockResolvedValue(null);
  prisma.deliveryCheckpoint.create.mockResolvedValue({
    id: "cp-1",
    deliveryId: "del-1",
    type: "PICKED_UP",
    actorRole: "TRANSPORTER",
    lat: -23.88,
    lng: 29.45,
    accuracyM: 12,
    clientAt: new Date(),
    recordedAt: new Date(),
    photoId: null,
    flags: ["NO_PHOTO"],
    note: null,
  });
}

describe("haversineKm", () => {
  it("is ~111km per degree of latitude", () => {
    expect(haversineKm(-23.0, 29.0, -24.0, 29.0)).toBeGreaterThan(110);
    expect(haversineKm(-23.0, 29.0, -24.0, 29.0)).toBeLessThan(112);
  });

  it("is ~0 for identical points", () => {
    expect(haversineKm(-23.9, 29.46, -23.9, 29.46)).toBeLessThan(0.001);
  });
});

describe("computeCheckpointFlags (CP15a geo-plausibility)", () => {
  const base = {
    clientAt: new Date("2026-10-20T10:00:00.000Z"),
    recordedAt: new Date("2026-10-20T10:00:05.000Z"),
    supplierPin: { lat: -23.88, lng: 29.45 },
    addressPin: { lat: -23.9, lng: 29.46 },
  };

  it("near both pins → only NO_PHOTO (the CP15b placeholder rule)", () => {
    expect(
      computeCheckpointFlags({
        ...base,
        type: "PICKED_UP",
        lat: -23.881,
        lng: 29.451,
        accuracyM: 10,
      }),
    ).toEqual(["NO_PHOTO"]);
  });

  it("pickup >50km from the supplier pin → GEO_FAR_PICKUP", () => {
    const flags = computeCheckpointFlags({
      ...base,
      type: "PICKED_UP",
      lat: -24.5,
      lng: 29.45,
      accuracyM: 10,
    });
    expect(flags).toContain("GEO_FAR_PICKUP");
  });

  it("delivery >25km from the address pin → GEO_FAR_DROP", () => {
    const flags = computeCheckpointFlags({
      ...base,
      type: "DELIVERED",
      lat: -24.2,
      lng: 29.46,
      accuracyM: 10,
    });
    expect(flags).toContain("GEO_FAR_DROP");
  });

  it("accuracy over 100m → LOW_ACCURACY", () => {
    const flags = computeCheckpointFlags({
      ...base,
      type: "IN_TRANSIT",
      lat: -23.88,
      lng: 29.45,
      accuracyM: 250,
    });
    expect(flags).toContain("LOW_ACCURACY");
  });

  it("GPS denied (no coords) → LOW_ACCURACY", () => {
    const flags = computeCheckpointFlags({ ...base, type: "IN_TRANSIT" });
    expect(flags).toContain("LOW_ACCURACY");
  });

  it("checkpoint without its reference pin → NO_REFERENCE_PIN", () => {
    const flags = computeCheckpointFlags({
      ...base,
      supplierPin: null,
      type: "PICKED_UP",
      lat: -23.88,
      lng: 29.45,
      accuracyM: 10,
    });
    expect(flags).toContain("NO_REFERENCE_PIN");
    expect(flags).not.toContain("GEO_FAR_PICKUP");
  });

  it("implausible jump between consecutive checkpoints → IMPOSSIBLE_SPEED", () => {
    const flags = computeCheckpointFlags({
      ...base,
      type: "IN_TRANSIT",
      lat: -22.9,
      lng: 29.45,
      accuracyM: 10,
      previous: {
        lat: -23.88,
        lng: 29.45,
        recordedAt: new Date("2026-10-20T09:59:05.000Z"),
      },
    });
    expect(flags).toContain("IMPOSSIBLE_SPEED");
  });

  it("plausible driving pace stays IMPOSSIBLE_SPEED-free", () => {
    // ~45km in 30min ≈ 90km/h.
    const flags = computeCheckpointFlags({
      ...base,
      type: "IN_TRANSIT",
      lat: -23.5,
      lng: 29.45,
      accuracyM: 10,
      previous: {
        lat: -23.88,
        lng: 29.45,
        recordedAt: new Date("2026-10-20T09:30:00.000Z"),
      },
    });
    expect(flags).not.toContain("IMPOSSIBLE_SPEED");
  });

  it("client clock 30min off → CLOCK_SKEW", () => {
    const flags = computeCheckpointFlags({
      ...base,
      type: "IN_TRANSIT",
      lat: -23.88,
      lng: 29.45,
      accuracyM: 10,
      clientAt: new Date("2026-10-20T09:30:00.000Z"),
    });
    expect(flags).toContain("CLOCK_SKEW");
  });

  it("IN_TRANSIT and FAILED never require a photo", () => {
    expect(
      computeCheckpointFlags({
        ...base,
        type: "IN_TRANSIT",
        lat: -23.88,
        lng: 29.45,
        accuracyM: 10,
      }),
    ).toEqual([]);
    expect(
      computeCheckpointFlags({
        ...base,
        type: "FAILED",
        lat: -23.88,
        lng: 29.45,
        accuracyM: 10,
      }),
    ).toEqual([]);
  });
});

describe("CheckpointsService.createCheckpoint", () => {
  it("404s on an unknown delivery", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(null);

    await expect(
      service.createCheckpoint("del-x", transporterActor, { type: "PICKED_UP" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s for a transporter who never claimed the delivery (no leak)", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(
      deliveryFixture({ transporterId: "tp-other" }),
    );
    prisma.transporterProfile.findUnique.mockResolvedValue({ id: "tp-1" });

    await expect(
      service.createCheckpoint("del-1", transporterActor, { type: "PICKED_UP" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s for a transporter without a profile", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
    prisma.transporterProfile.findUnique.mockResolvedValue(null);

    await expect(
      service.createCheckpoint("del-1", transporterActor, { type: "PICKED_UP" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s for the supplier once the delivery is transporter-owned (CP14 lockout holds)", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());

    await expect(
      service.createCheckpoint("del-1", supplierActor, { type: "DELIVERED" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("404s for a foreign supplier on a self-delivery", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(
      deliveryFixture({ transporterId: null }),
    );
    prisma.deliveryCheckpoint.findFirst.mockResolvedValue(null);

    await expect(
      service.createCheckpoint("del-1", { id: "other", role: "SUPPLIER" }, {
        type: "PICKED_UP",
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("403s any other role (service-level belt and braces)", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());

    await expect(
      service.createCheckpoint("del-1", { id: "buyer-1", role: "BUYER" }, {
        type: "PICKED_UP",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects a half GPS pair", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());

    await expect(
      service.createCheckpoint("del-1", transporterActor, {
        type: "PICKED_UP",
        lat: -23.88,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("records the assigned transporter's checkpoint with computed flags", async () => {
    const { service, prisma } = makeService();
    primeAssignedTransporter(prisma);

    const result = await service.createCheckpoint("del-1", transporterActor, {
      type: "PICKED_UP",
      lat: -23.881,
      lng: 29.451,
      accuracyM: 12,
      note: "crates loaded",
    });

    expect(result.flags).toEqual(["NO_PHOTO"]);
    expect(prisma.deliveryCheckpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryId: "del-1",
          type: "PICKED_UP",
          actorUserId: "tp-user-1",
          actorRole: "TRANSPORTER",
          flags: ["NO_PHOTO"],
          note: "crates loaded",
        }),
      }),
    );
  });

  it("accepts self-delivery evidence from the owning supplier", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(
      deliveryFixture({ transporterId: null }),
    );
    prisma.deliveryCheckpoint.findFirst.mockResolvedValue(null);
    prisma.deliveryCheckpoint.create.mockResolvedValue({ id: "cp-self" });

    const result = await service.createCheckpoint("del-1", supplierActor, {
      type: "PICKED_UP",
      lat: -23.88,
      lng: 29.45,
      accuracyM: 8,
    });

    expect(result).toEqual({ id: "cp-self" });
    expect(prisma.deliveryCheckpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorRole: "SUPPLIER",
        }),
      }),
    );
  });

  it("speed checks consider the previous checkpoint of the same delivery", async () => {
    const { service, prisma } = makeService();
    primeAssignedTransporter(prisma);
    // Previous checkpoint 10 minutes ago, ~100km away → impossible.
    prisma.deliveryCheckpoint.findFirst.mockResolvedValue({
      lat: -22.9,
      lng: 29.45,
      recordedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    prisma.deliveryCheckpoint.create.mockResolvedValue({
      id: "cp-2",
      flags: ["IMPOSSIBLE_SPEED"],
    });

    const result = await service.createCheckpoint("del-1", transporterActor, {
      type: "IN_TRANSIT",
      lat: -23.88,
      lng: 29.45,
      accuracyM: 10,
    });

    expect(result.flags).toContain("IMPOSSIBLE_SPEED");
    expect(prisma.deliveryCheckpoint.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deliveryId: "del-1" }),
      }),
    );
  });
});

describe("CheckpointsService.listCheckpoints", () => {
  it("returns the ordered ledger to the buyer owner", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
    prisma.deliveryCheckpoint.findMany.mockResolvedValue([
      { id: "cp-1", type: "PICKED_UP" },
      { id: "cp-2", type: "DELIVERED" },
    ]);

    const rows = await service.listCheckpoints("del-1", {
      id: "buyer-1",
      role: "BUYER",
    });

    expect(rows).toHaveLength(2);
    expect(prisma.deliveryCheckpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deliveryId: "del-1" },
        orderBy: { recordedAt: "asc" },
      }),
    );
  });

  it("never exposes actorUserId to the audience", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
    prisma.deliveryCheckpoint.findMany.mockResolvedValue([]);

    await service.listCheckpoints("del-1", { id: "buyer-1", role: "BUYER" });

    const select = prisma.deliveryCheckpoint.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("actorUserId");
  });

  it("404s a foreign buyer", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());

    await expect(
      service.listCheckpoints("del-1", { id: "buyer-x", role: "BUYER" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("lets an admin read any delivery's ledger", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
    prisma.deliveryCheckpoint.findMany.mockResolvedValue([]);

    await expect(
      service.listCheckpoints("del-1", { id: "admin-1", role: "ADMIN" }),
    ).resolves.toEqual([]);
  });

  it("404s a transporter who did not claim the delivery", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(
      deliveryFixture({ transporterId: "tp-other" }),
    );
    prisma.transporterProfile.findUnique.mockResolvedValue({ id: "tp-1" });

    await expect(
      service.listCheckpoints("del-1", transporterActor),
    ).rejects.toThrow(NotFoundException);
  });

  it("serves the owning supplier", async () => {
    const { service, prisma } = makeService();
    prisma.delivery.findUnique.mockResolvedValue(deliveryFixture());
    prisma.deliveryCheckpoint.findMany.mockResolvedValue([]);

    await expect(
      service.listCheckpoints("del-1", supplierActor),
    ).resolves.toEqual([]);
  });
});

describe("ledger is create-only by construction", () => {
  it("exposes no update/patch/delete paths anywhere on the service", () => {
    const { service } = makeService();
    const svc = service as unknown as Record<string, unknown>;
    for (const forbidden of [
      "updateCheckpoint",
      "patchCheckpoint",
      "deleteCheckpoint",
      "removeCheckpoint",
    ]) {
      expect(svc[forbidden]).toBeUndefined();
    }
  });
});
