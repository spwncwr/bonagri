import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CheckpointTypeValue,
  CreateCheckpointDto,
} from "./dto/create-checkpoint.dto";

// Great-circle distance in km — the geo-flag thresholds ride on this
// (50km pickup, 25km drop, 140km/h implied speed).
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const GEO_FAR_PICKUP_KM = 50;
const GEO_FAR_DROP_KM = 25;
const MAX_SPEED_KMH = 140;
const LOW_ACCURACY_M = 100;
const CLOCK_SKEW_MS = 10 * 60 * 1000;
// Sub-100m jitter between same-second checkpoints is not an impossibility.
const SPEED_MIN_DISTANCE_KM = 0.1;

type PinLike = { lat: number | null; lng: number | null } | null | undefined;

// Pure flag engine (exported for direct unit testing). Flags are evidence
// annotations for governance (CP15d) — they never block anything.
export function computeCheckpointFlags(input: {
  type: CheckpointTypeValue;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  supplierPin?: PinLike;
  addressPin?: PinLike;
  previous?: PinLike & { recordedAt?: Date } | null;
  clientAt: Date;
  recordedAt: Date;
  hasPhoto?: boolean;
}): string[] {
  const flags: string[] = [];
  const hasGps = input.lat != null && input.lng != null;

  if (
    !hasGps ||
    (input.accuracyM != null && input.accuracyM > LOW_ACCURACY_M)
  ) {
    flags.push("LOW_ACCURACY");
  }

  if (hasGps) {
    if (input.type === "PICKED_UP") {
      const pin = input.supplierPin;
      if (pin?.lat != null && pin?.lng != null) {
        if (
          haversineKm(input.lat!, input.lng!, pin.lat, pin.lng) >
          GEO_FAR_PICKUP_KM
        ) {
          flags.push("GEO_FAR_PICKUP");
        }
      } else {
        flags.push("NO_REFERENCE_PIN");
      }
    }

    if (input.type === "DELIVERED") {
      const pin = input.addressPin;
      if (pin?.lat != null && pin?.lng != null) {
        if (
          haversineKm(input.lat!, input.lng!, pin.lat, pin.lng) >
          GEO_FAR_DROP_KM
        ) {
          flags.push("GEO_FAR_DROP");
        }
      } else {
        flags.push("NO_REFERENCE_PIN");
      }
    }

    const prev = input.previous;
    if (prev?.lat != null && prev?.lng != null && prev.recordedAt) {
      const distance = haversineKm(input.lat!, input.lng!, prev.lat, prev.lng);
      const hours =
        (input.recordedAt.getTime() - prev.recordedAt.getTime()) / 3_600_000;
      const speed = hours > 0 ? distance / hours : Number.POSITIVE_INFINITY;
      if (distance > SPEED_MIN_DISTANCE_KM && speed > MAX_SPEED_KMH) {
        flags.push("IMPOSSIBLE_SPEED");
      }
    }
  }

  if (
    Math.abs(input.clientAt.getTime() - input.recordedAt.getTime()) >
    CLOCK_SKEW_MS
  ) {
    flags.push("CLOCK_SKEW");
  }

  // Photos land in CP15b; the requirement rule exists from day one so every
  // required checkpoint carries NO_PHOTO until evidence is uploadable.
  if (
    (input.type === "PICKED_UP" || input.type === "DELIVERED") &&
    !input.hasPhoto
  ) {
    flags.push("NO_PHOTO");
  }

  return flags;
}

// Response projection — actorUserId stays server-side (audience sees the
// role, never the account id — CP14 PII discipline).
const CHECKPOINT_SELECT = {
  id: true,
  deliveryId: true,
  type: true,
  actorRole: true,
  lat: true,
  lng: true,
  accuracyM: true,
  clientAt: true,
  recordedAt: true,
  photoId: true,
  flags: true,
  note: true,
} as const;

@Injectable()
export class CheckpointsService {
  constructor(private readonly prisma: PrismaService) {}

  // Delivery + counterparty context in one read.
  private async loadDelivery(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            deliveryAddress: { select: { id: true, lat: true, lng: true } },
            items: {
              select: {
                product: {
                  select: {
                    supplierId: true,
                    supplier: {
                      select: { id: true, userId: true, lat: true, lng: true },
                    },
                  },
                },
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException("Delivery not found");
    }

    // CP10 orders carry a single supplier's lines; take the first for pin +
    // ownership context.
    const supplier = delivery.order.items[0]?.product?.supplier ?? null;
    return { delivery, order: delivery.order, supplier };
  }

  async createCheckpoint(
    deliveryId: string,
    actor: { id: string; role: string },
    dto: CreateCheckpointDto,
  ) {
    if ((dto.lat == null) !== (dto.lng == null)) {
      throw new BadRequestException(
        "lat and lng must be provided together (or both omitted)",
      );
    }

    const { delivery, order, supplier } = await this.loadDelivery(deliveryId);

    if (actor.role === "TRANSPORTER") {
      const profile = await this.prisma.transporterProfile.findUnique({
        where: { userId: actor.id },
      });
      // Foreign or unassigned → 404 (no existence leak, CP14 convention).
      if (!profile || delivery.transporterId !== profile.id) {
        throw new NotFoundException("Delivery not found");
      }
    } else if (actor.role === "SUPPLIER") {
      // Self-delivery evidence only (CP12 behaviour): once a transporter
      // owns the delivery the ledger is theirs; foreign supplier → 404.
      if (
        delivery.transporterId !== null ||
        !supplier ||
        supplier.userId !== actor.id
      ) {
        throw new NotFoundException("Delivery not found");
      }
    } else {
      throw new ForbiddenException(
        "Only the assigned transporter or the delivering supplier may record checkpoints",
      );
    }

    const previous = await this.prisma.deliveryCheckpoint.findFirst({
      where: { deliveryId, lat: { not: null }, lng: { not: null } },
      orderBy: { recordedAt: "desc" },
      select: { lat: true, lng: true, recordedAt: true },
    });

    const recordedAt = new Date();
    const clientAt = dto.clientAt ? new Date(dto.clientAt) : recordedAt;

    const flags = computeCheckpointFlags({
      type: dto.type,
      lat: dto.lat,
      lng: dto.lng,
      accuracyM: dto.accuracyM,
      supplierPin: supplier,
      addressPin: order.deliveryAddress,
      previous,
      clientAt,
      recordedAt,
      hasPhoto: false,
    });

    const created = await this.prisma.deliveryCheckpoint.create({
      data: {
        deliveryId,
        type: dto.type,
        actorUserId: actor.id,
        actorRole: actor.role,
        lat: dto.lat,
        lng: dto.lng,
        accuracyM: dto.accuracyM,
        clientAt,
        recordedAt,
        flags,
        note: dto.note,
      },
      select: CHECKPOINT_SELECT,
    });

    return created;
  }

  // Append-only read: ordered ledger for the order's counterparties.
  async listCheckpoints(
    deliveryId: string,
    actor: { id: string; role: string },
  ) {
    const { delivery, order, supplier } = await this.loadDelivery(deliveryId);

    const isBuyer = order.userId === actor.id;
    const isSupplier = !!supplier && supplier.userId === actor.id;
    let isTransporter = false;
    if (actor.role === "TRANSPORTER") {
      const profile = await this.prisma.transporterProfile.findUnique({
        where: { userId: actor.id },
      });
      isTransporter = !!profile && delivery.transporterId === profile.id;
    }

    if (
      actor.role !== "ADMIN" &&
      !isBuyer &&
      !isSupplier &&
      !isTransporter
    ) {
      throw new NotFoundException("Delivery not found");
    }

    return this.prisma.deliveryCheckpoint.findMany({
      where: { deliveryId },
      orderBy: { recordedAt: "asc" },
      select: CHECKPOINT_SELECT,
    });
  }
}
