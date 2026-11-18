// C1 (plan §6): the cart → delivery → payment split hands its draft state
// across steps with sessionStorage — the same per-tab hand-off HP1 uses for
// the payment method (lib/payment-methods.ts). The API body is unchanged:
// POST /api/cart/checkout still takes { deliveryAddressId, notes }.

export const CHECKOUT_NOTES_KEY = "bonagri_checkout_notes";
export const CHECKOUT_ADDRESS_KEY = "bonagri_checkout_address";
// F1: when set, the checkout steps run in "quote mode" — one accepted quote
// converts to one order at the agreed price instead of the cart contents.
export const CHECKOUT_QUOTE_KEY = "bonagri_checkout_quote";

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
  window.sessionStorage.removeItem(CHECKOUT_QUOTE_KEY);
}

// F1 quote draft: the payload the accepted-quote card writes before
// routing to /checkout/delivery. Only the id is load-bearing (the API
// re-validates everything server-side); the rest is display sugar for the
// summary card so the steps render without refetching the quote.
export type CheckoutQuoteDraft = {
  responseId: string;
  product: string;
  supplier: string;
  quantity: number;
  unit: string;
  quotedPrice: number;
};

export function readCheckoutQuote(): CheckoutQuoteDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(CHECKOUT_QUOTE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CheckoutQuoteDraft;
    return typeof parsed?.responseId === "string" ? parsed : null;
  } catch {
    // A corrupt draft must not break checkout — fall back to cart mode.
    return null;
  }
}

export function writeCheckoutQuote(quote: CheckoutQuoteDraft): void {
  window.sessionStorage.setItem(CHECKOUT_QUOTE_KEY, JSON.stringify(quote));
}

// Cart entry points clear any lingering quote draft so the cart flow can
// never accidentally post to the quote endpoint (and vice versa: writing
// a quote draft is what puts checkout into quote mode).
export function clearCheckoutQuote(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CHECKOUT_QUOTE_KEY);
}
