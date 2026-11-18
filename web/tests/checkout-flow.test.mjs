import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const cart = read("../components/mobile/cart-screen.tsx");
const delivery = read("../app/checkout/delivery/page.tsx");
const checkout = read("../app/checkout/page.tsx");
const stepper = read("../components/checkout/stepper.tsx");
const draft = read("../lib/checkout-draft.ts");
const shell = read("../components/marketplace/home-shell.tsx");

// C1 (plan §6): the buyer flow splits into three focused screens — cart
// (items + bill details), delivery (address + pin + instructions) and
// checkout (payment + total summary) — with a visible stepper and
// sessionStorage draft hand-off between them.

test("cart owns line items and bill details only", () => {
  assert.match(cart, /Bill details/);
  // delivery concerns moved to /checkout/delivery
  assert.ok(!/Deliver to/.test(cart), "cart must not pick addresses");
  assert.ok(!/Delivery instructions/.test(cart), "cart must not collect notes");
  assert.ok(!/LocationPicker/.test(cart), "cart must not own the map pin");
  assert.ok(!/name="delivery-address"/.test(cart));
  assert.ok(!/sessionStorage/.test(cart), "cart keeps no drafts itself");

  assert.match(cart, /current="cart"/, "cart shows the stepper");
  assert.match(cart, /Continue to delivery/);
  assert.match(cart, /router\.push\("\/checkout\/delivery"\)/);
});

test("the delivery step owns address selection, pin and instructions", () => {
  assert.match(delivery, /name="delivery-address"/);
  assert.match(delivery, /LocationPicker/);
  assert.match(delivery, /htmlFor="delivery-notes"/);
  assert.match(delivery, /current="delivery"/);

  // draft hand-off forward
  assert.match(delivery, /writeCheckoutAddressId\(selectedAddressId\)/);
  assert.match(delivery, /writeCheckoutNotes\(notes\)/);
  assert.match(delivery, /router\.push\("\/checkout"\)/);

  // guards: empty cart bounces back; pin stays informational
  assert.match(delivery, /href="\/cart"/);
  assert.match(delivery, /informational only/);

  // nothing payment-related lives here
  assert.ok(!/PAYMENT_METHODS/.test(delivery));
  assert.ok(!/aria-label="Payment method"/.test(delivery));
});

test("checkout renders payment, total summary and a read-only delivery summary", () => {
  assert.match(checkout, /current="payment"/);
  assert.match(checkout, /aria-label="Payment method"/);

  // HP1 layout contract still holds: delivery echo → payment → orders
  const addressAt = checkout.indexOf("Deliver to");
  const cardAt = checkout.indexOf('aria-label="Payment method"');
  const ordersAt = checkout.indexOf("Your orders (");
  assert.ok(addressAt !== -1, "read-only delivery summary is missing");
  assert.ok(addressAt < cardAt, "delivery summary must precede the card");
  assert.ok(cardAt < ordersAt, "card must precede the order preview");

  // total summary + the way back to edit delivery details
  assert.match(checkout, /Summary/);
  assert.ok(
    (checkout.match(/href="\/checkout\/delivery"/g) ?? []).length >= 1,
    "Change link must return to the delivery step",
  );

  // no editing surfaces — address radio and notes textarea are gone
  assert.ok(!/name="delivery-address"/.test(checkout));
  assert.ok(!/<textarea/.test(checkout));

  // draft forwarded at place time, cleared once the order is in
  assert.match(checkout, /readCheckoutNotes\(\)/);
  assert.match(checkout, /clearCheckoutDraft\(\)/);
});

test("the stepper shows three ordered steps and marks the current one", () => {
  assert.match(stepper, /aria-current="step"/);
  // step routes come from the STEPS registry the three screens share
  assert.match(stepper, /href: "\/cart"/);
  assert.match(stepper, /href: "\/checkout\/delivery"/);
  assert.match(stepper, /href: "\/checkout"/);
  // completed steps are links, upcoming steps stay inert (flow runs in order)
  assert.match(stepper, /done \?/);
  assert.match(stepper, /isCurrent \?/);
});

test("draft keys live in one module and both entry points start at delivery", () => {
  assert.match(draft, /CHECKOUT_NOTES_KEY/);
  assert.match(draft, /CHECKOUT_ADDRESS_KEY/);
  assert.match(draft, /export function clearCheckoutDraft/);

  // the cart no longer exports the notes key (moved to lib/checkout-draft)
  assert.ok(!/export const CHECKOUT_NOTES_KEY/.test(cart));

  // the shell's cart drawer drops the buyer on the delivery step
  assert.match(shell, /router\.push\("\/checkout\/delivery"\)/);
});
