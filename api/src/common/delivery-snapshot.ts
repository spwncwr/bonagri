// Immutable delivery-destination snapshot (Order.deliverySnapshot, JsonB).
//
// Written server-side at order creation from the validated Address row, so
// later edits to (or removal attempts on) the saved address never change a
// historical order's destination. Readers materialize the response's
// `deliveryAddress` from the snapshot when present; a null snapshot falls
// back to the live relation — the same Address shape either way, so no API
// consumer sees a different structure.
//
// Coordinates are both-or-neither: a partial or out-of-range pair is
// normalized to null (never fabricated, never a reason to block checkout).

export type DeliverySnapshot = {
  addressId: string;
  label: string;
  recipientName: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  snapshottedAt: string;
};

// The Address scalars this module reads (structurally typed so plain test
// fixtures work without importing the generated client).
export type SnapshotAddressInput = {
  id: string;
  label: string;
  recipientName: string;
  phone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type SnapshotBearing<A> = {
  deliverySnapshot?: unknown;
  deliveryAddress: A;
};

function isValidPin(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

// Defensive parse: only our own writer and the migration produce these
// rows, but a malformed value must degrade to the live relation rather
// than throw inside list responses.
export function normalizeDeliverySnapshot(
  raw: unknown,
): DeliverySnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;

  const s = raw as Record<string, unknown>;

  if (
    typeof s.addressId !== "string" ||
    typeof s.addressLine1 !== "string" ||
    typeof s.city !== "string"
  ) {
    return null;
  }

  const hasPin = isValidPin(s.lat, s.lng);

  return {
    addressId: s.addressId,
    label: typeof s.label === "string" ? s.label : "",
    recipientName:
      typeof s.recipientName === "string" ? s.recipientName : "",
    phone: typeof s.phone === "string" ? s.phone : null,
    addressLine1: s.addressLine1,
    addressLine2: typeof s.addressLine2 === "string" ? s.addressLine2 : null,
    city: s.city,
    province: typeof s.province === "string" ? s.province : null,
    postalCode: typeof s.postalCode === "string" ? s.postalCode : null,
    country: typeof s.country === "string" ? s.country : "South Africa",
    lat: hasPin ? (s.lat as number) : null,
    lng: hasPin ? (s.lng as number) : null,
    snapshottedAt: typeof s.snapshottedAt === "string" ? s.snapshottedAt : "",
  };
}

// Snapshot payload for order creation. Reused by both creation paths
// (cart checkout and single-product order) so they cannot drift apart.
export function buildDeliverySnapshot(
  address: SnapshotAddressInput,
): DeliverySnapshot {
  const hasPin = isValidPin(address.lat, address.lng);

  return {
    addressId: address.id,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone ?? null,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? null,
    city: address.city,
    province: address.province ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country ?? "South Africa",
    lat: hasPin ? (address.lat as number) : null,
    lng: hasPin ? (address.lng as number) : null,
    snapshottedAt: new Date().toISOString(),
  };
}

// Response projection: the snapshot's destination content wins; the live
// relation still supplies the stable columns (id, userId, isDefault,
// timestamps) so response shapes stay identical to pre-snapshot APIs.
export function materializeDeliveryAddress<A extends SnapshotAddressInput>(
  order: SnapshotBearing<A>,
): A {
  const snapshot = normalizeDeliverySnapshot(order.deliverySnapshot);

  if (!snapshot) {
    return order.deliveryAddress;
  }

  return {
    ...order.deliveryAddress,
    label: snapshot.label,
    recipientName: snapshot.recipientName,
    phone: snapshot.phone,
    addressLine1: snapshot.addressLine1,
    addressLine2: snapshot.addressLine2,
    city: snapshot.city,
    province: snapshot.province,
    postalCode: snapshot.postalCode,
    country: snapshot.country,
    lat: snapshot.lat,
    lng: snapshot.lng,
  };
}

// The destination pin for geo comparisons (checkpoint plausibility flags):
// the snapshot pin whenever the order carries one — a later edit to the
// saved address never re-points it. When the order was placed without a
// pin (or predates snapshots), the live relation is the best available
// reference, so a buyer who confirms the location afterwards still gets
// proximity evidence on the in-flight delivery. Stored coordinates are
// re-validated here so garbage degrades to null instead of a bogus
// comparison. This never feeds order responses — materializeDeliveryAddress
// keeps the served destination frozen either way.
export function effectiveAddressPin<A extends { lat?: number | null; lng?: number | null }>(
  order: SnapshotBearing<A>,
): { lat: number | null; lng: number | null } {
  const snapshot = normalizeDeliverySnapshot(order.deliverySnapshot);

  if (snapshot && snapshot.lat != null && snapshot.lng != null) {
    return { lat: snapshot.lat, lng: snapshot.lng };
  }

  const lat = order.deliveryAddress.lat ?? null;
  const lng = order.deliveryAddress.lng ?? null;

  return isValidPin(lat, lng) ? { lat, lng } : { lat: null, lng: null };
}
