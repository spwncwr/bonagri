// HP1: payment-method selection at checkout (plan D1).
//
// Only MANUAL_EFT is selectable today — PAYFAST (card) and OZOW (instant EFT)
// are honest "Coming soon" placeholders until a gateway phase lands. The
// selection is a checkout-time UI choice only: the POST /api/cart/checkout body
// is unchanged, and a Payment row is still created solely by the CP11 manual
// EFT evidence flow.

export type PaymentMethodId = "MANUAL_EFT" | "PAYFAST" | "OZOW";

export type PaymentMethodOption = {
  id: PaymentMethodId;
  label: string;
  detail: string;
  available: boolean;
};

// Same hand-off pattern as the cart screen's checkout notes.
export const CHECKOUT_PAYMENT_METHOD_KEY = "bonagri_checkout_payment_method";

export const DEFAULT_PAYMENT_METHOD: PaymentMethodId = "MANUAL_EFT";

export const PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: "MANUAL_EFT",
    label: "Manual EFT",
    detail:
      "Pay from your bank app and record the EFT reference after ordering — the supplier verifies it against their statement.",
    available: true,
  },
  {
    id: "PAYFAST",
    label: "Card",
    detail: "PayFast card payments — integration coming soon.",
    available: false,
  },
  {
    id: "OZOW",
    label: "Instant EFT",
    detail: "Ozow instant EFT — integration coming soon.",
    available: false,
  },
];

// A stored value only counts when it names a method that is actually
// selectable — a stale/unknown id falls back to the default.
export function isSelectablePaymentMethod(
  value: unknown,
): value is PaymentMethodId {
  return (
    typeof value === "string" &&
    PAYMENT_METHODS.some((method) => method.id === value && method.available)
  );
}

export function paymentMethodLabel(id: PaymentMethodId): string {
  return (
    PAYMENT_METHODS.find((method) => method.id === id)?.label ??
    PAYMENT_METHODS[0].label
  );
}
