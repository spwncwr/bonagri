import {
  buildDeliverySnapshot,
  effectiveAddressPin,
  materializeDeliveryAddress,
  normalizeDeliverySnapshot,
} from "./delivery-snapshot";

const fullAddress = {
  id: "addr-1",
  userId: "buyer-1",
  label: "Home",
  recipientName: "Thandi",
  phone: "072 111 2222",
  addressLine1: "1 Marula St",
  addressLine2: null as string | null,
  city: "Tzaneen",
  province: "Limpopo",
  postalCode: "0880",
  country: "South Africa",
  isDefault: true,
  lat: -23.8333 as number | null,
  lng: 30.1667 as number | null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
};

describe("buildDeliverySnapshot", () => {
  it("freezes the address text and the confirmed pin", () => {
    const snapshot = buildDeliverySnapshot(fullAddress);

    expect(snapshot).toMatchObject({
      addressId: "addr-1",
      label: "Home",
      recipientName: "Thandi",
      phone: "072 111 2222",
      addressLine1: "1 Marula St",
      city: "Tzaneen",
      province: "Limpopo",
      postalCode: "0880",
      country: "South Africa",
      lat: -23.8333,
      lng: 30.1667,
    });
    expect(Number.isNaN(Date.parse(snapshot.snapshottedAt))).toBe(false);
  });

  it("keeps a pin-less address pin-less (never invents coordinates)", () => {
    const snapshot = buildDeliverySnapshot({
      ...fullAddress,
      lat: null,
      lng: null,
    });

    expect(snapshot.lat).toBeNull();
    expect(snapshot.lng).toBeNull();
  });

  it("normalizes a partial pair to no pin instead of half a coordinate", () => {
    const snapshot = buildDeliverySnapshot({
      ...fullAddress,
      lat: -23.8,
      lng: null,
    });

    expect(snapshot.lat).toBeNull();
    expect(snapshot.lng).toBeNull();
  });

  it("rejects out-of-range coordinates as no pin", () => {
    const snapshot = buildDeliverySnapshot({
      ...fullAddress,
      lat: 123.4,
      lng: 30.1,
    });

    expect(snapshot.lat).toBeNull();
    expect(snapshot.lng).toBeNull();
  });
});

describe("materializeDeliveryAddress", () => {
  it("returns the live relation when there is no snapshot (legacy rows)", () => {
    const order = { deliverySnapshot: null, deliveryAddress: fullAddress };

    expect(materializeDeliveryAddress(order)).toBe(fullAddress);
  });

  it("lets the snapshot's destination win over later address edits", () => {
    const order = {
      deliverySnapshot: buildDeliverySnapshot(fullAddress),
      deliveryAddress: {
        ...fullAddress,
        addressLine2: "Edited later",
        city: "Polokwane",
        lat: -23.9045,
        lng: 29.4689,
      },
    };

    const result = materializeDeliveryAddress(order);

    expect(result.city).toBe("Tzaneen");
    expect(result.addressLine2).toBeNull();
    expect(result.lat).toBe(-23.8333);
    expect(result.lng).toBe(30.1667);
    // Stable columns still come from the relation row.
    expect(result.id).toBe("addr-1");
    expect(result.userId).toBe("buyer-1");
    expect(result.isDefault).toBe(true);
  });

  it("keeps the destination pin-less when the order had no pin", () => {
    const order = {
      deliverySnapshot: buildDeliverySnapshot({
        ...fullAddress,
        lat: null,
        lng: null,
      }),
      // A pin was added to the address AFTER the order was placed.
      deliveryAddress: { ...fullAddress, lat: -23.8333, lng: 30.1667 },
    };

    const result = materializeDeliveryAddress(order);

    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it("degrades to the live relation on a malformed snapshot", () => {
    const order = {
      deliverySnapshot: { nonsense: true },
      deliveryAddress: fullAddress,
    };

    expect(materializeDeliveryAddress(order)).toBe(fullAddress);
  });
});

describe("effectiveAddressPin", () => {
  it("prefers the snapshot pin over the live relation", () => {
    const pin = effectiveAddressPin({
      deliverySnapshot: buildDeliverySnapshot(fullAddress),
      deliveryAddress: { ...fullAddress, lat: 1, lng: 2 },
    });

    expect(pin).toEqual({ lat: -23.8333, lng: 30.1667 });
  });

  it("uses the live pin only when the order never carried one", () => {
    const pin = effectiveAddressPin({
      deliverySnapshot: buildDeliverySnapshot({
        ...fullAddress,
        lat: null,
        lng: null,
      }),
      deliveryAddress: { ...fullAddress, lat: -23.8333, lng: 30.1667 },
    });

    expect(pin).toEqual({ lat: -23.8333, lng: 30.1667 });
  });

  it("degrades out-of-range live coordinates to null instead of comparing", () => {
    const pin = effectiveAddressPin({
      deliverySnapshot: null,
      deliveryAddress: { ...fullAddress, lat: 999, lng: 30.1667 },
    });

    expect(pin).toEqual({ lat: null, lng: null });
  });

  it("falls back to the relation only when no snapshot exists", () => {
    const pin = effectiveAddressPin({
      deliverySnapshot: null,
      deliveryAddress: { ...fullAddress },
    });

    expect(pin).toEqual({ lat: -23.8333, lng: 30.1667 });
  });
});

describe("normalizeDeliverySnapshot", () => {
  it("returns null for non-objects and missing core fields", () => {
    expect(normalizeDeliverySnapshot(null)).toBeNull();
    expect(normalizeDeliverySnapshot("addr-1")).toBeNull();
    expect(normalizeDeliverySnapshot({ addressId: "addr-1" })).toBeNull();
  });
});
