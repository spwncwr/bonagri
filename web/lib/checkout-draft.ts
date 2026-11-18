// C1 (plan §6): the cart → delivery → payment split hands its draft state
// across steps with sessionStorage — the same per-tab hand-off HP1 uses for
// the payment method (lib/payment-methods.ts). The API body is unchanged:
// POST /api/cart/checkout still takes { deliveryAddressId, notes }.

export const CHECKOUT_NOTES_KEY = "bonagri_checkout_notes";
export const CHECKOUT_ADDRESS_KEY = "bonagri_checkout_address";

// Guards keep these safe to call from module scope or render paths during
// SSR — the pages themselves only touch them inside effects/handlers.

export function readCheckoutNotes(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(CHECKOUT_NOTES_KEY) ?? "";
}

export function writeCheckoutNotes(notes: string): void {
  const trimmed = notes.trim();

  if (trimmed) {
    window.sessionStorage.setItem(CHECKOUT_NOTES_KEY, trimmed);
  } else {
    window.sessionStorage.removeItem(CHECKOUT_NOTES_KEY);
  }
}

export function readCheckoutAddressId(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(CHECKOUT_ADDRESS_KEY) ?? "";
}

export function writeCheckoutAddressId(addressId: string): void {
  if (addressId) {
    window.sessionStorage.setItem(CHECKOUT_ADDRESS_KEY, addressId);
  } else {
    window.sessionStorage.removeItem(CHECKOUT_ADDRESS_KEY);
  }
}

// Called once the orders are placed so a later checkout starts fresh.
export function clearCheckoutDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CHECKOUT_NOTES_KEY);
  window.sessionStorage.removeItem(CHECKOUT_ADDRESS_KEY);
}
