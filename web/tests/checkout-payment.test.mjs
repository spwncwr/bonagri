import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const checkout = read("../app/checkout/page.tsx");
const orderPage = read("../app/orders/[id]/page.tsx");
const lib = read("../lib/payment-methods.ts");

// HP1 (plan D1): the payment-method screen is UI-only — Manual EFT live,
// PayFast/Ozow honest placeholders, no checkout API change.

test("the method registry offers exactly one live option and two placeholders", () => {
  assert.match(lib, /id: "MANUAL_EFT"/);
  assert.match(lib, /id: "PAYFAST"/);
  assert.match(lib, /id: "OZOW"/);
  // two "Coming soon" placeholders, one selectable method
  assert.equal((lib.match(/available: false/g) ?? []).length, 2);
  assert.equal((lib.match(/available: true/g) ?? []).length, 1);
  // stale/unknown stored values are rejected, not trusted
  assert.match(lib, /export function isSelectablePaymentMethod/);
  assert.match(lib, /method\.available/);
  assert.match(lib, /DEFAULT_PAYMENT_METHOD: PaymentMethodId = "MANUAL_EFT"/);
});

test("checkout renders the payment card between address and order preview", () => {
  const cardAt = checkout.indexOf('aria-label="Payment method"');
  assert.notEqual(cardAt, -1, "payment card section is missing");
  const addressAt = checkout.indexOf("Deliver to");
  const ordersAt = checkout.indexOf("Your orders (");
  assert.ok(addressAt !== -1 && addressAt < cardAt, "card must follow address");
  assert.ok(cardAt < ordersAt, "card must precede the order preview");

  // live option is a real radio bound to component state
  assert.match(checkout, /name="payment-method"/);
  assert.match(checkout, /checked=\{selected\}/);
  assert.match(checkout, /choosePaymentMethod\(method\.id\)/);
  // placeholders render disabled with an honest badge
  assert.match(checkout, /Coming soon/);
  assert.match(checkout, /aria-disabled="true"/);
});

test("the choice is persisted for hand-off and the API body stays unchanged", () => {
  // written on select AND at place-time (the default selection never fires
  // onChange, but the order-detail echo must still find it), restored on load
  assert.match(
    checkout,
    /window\.sessionStorage\.setItem\(CHECKOUT_PAYMENT_METHOD_KEY, id\)/,
  );
  assert.match(
    checkout,
    /window\.sessionStorage\.setItem\(CHECKOUT_PAYMENT_METHOD_KEY, paymentMethod\)/,
  );
  assert.match(
    checkout,
    /window\.sessionStorage\.getItem\(\s*CHECKOUT_PAYMENT_METHOD_KEY,?\s*\)/,
  );
  assert.match(checkout, /isSelectablePaymentMethod\(storedMethod\)/);

  // D1: POST /cart/checkout body must carry only address + notes
  const bodyAt = checkout.indexOf("body: JSON.stringify({");
  assert.notEqual(bodyAt, -1);
  const bodyEnd = checkout.indexOf("})", bodyAt);
  const body = checkout.slice(bodyAt, bodyEnd);
  assert.match(body, /deliveryAddressId/);
  assert.match(body, /notes/);
  assert.ok(
    !/payment/i.test(body),
    `checkout body must not gain a payment field: ${body}`,
  );
});

test("the chosen method is echoed on the success screen and order detail", () => {
  // success screen
  assert.match(checkout, /Payment method: \{paymentMethodLabel\(paymentMethod\)\}/);
  // order detail reads the hand-off and labels it (only while unrecorded —
  // once a Payment row exists CP11's own "Manual EFT · …" line takes over)
  assert.match(orderPage, /CHECKOUT_PAYMENT_METHOD_KEY/);
  assert.match(orderPage, /isSelectablePaymentMethod\(storedMethod\)/);
  assert.match(orderPage, /Payment method:/);
  assert.match(orderPage, /paymentMethodLabel\(checkoutMethod\)/);
});
