import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const draft = read("../lib/checkout-draft.ts");
const requests = read("../app/requests/page.tsx");
const demand = read("../app/supplier/demand/page.tsx");
const delivery = read("../app/checkout/delivery/page.tsx");
const checkout = read("../app/checkout/page.tsx");
const cart = read("../components/mobile/cart-screen.tsx");
const shell = read("../components/marketplace/home-shell.tsx");

// F1 (plan §6): an accepted, product-backed quote converts into an order
// at the agreed price — supplier attaches a listing when quoting, buyer
// proceeds through the shared C1 delivery → payment steps via a
// sessionStorage quote draft, and cart entry points always clear it.

test("the quote draft lives with the other checkout drafts", () => {
  assert.match(draft, /CHECKOUT_QUOTE_KEY/);
  assert.match(draft, /export function readCheckoutQuote/);
  assert.match(draft, /export function writeCheckoutQuote/);
  assert.match(draft, /export function clearCheckoutQuote/);
  // clearing everything (after placement) drops the quote too
  assert.match(
    draft,
    /export function clearCheckoutDraft[\s\S]*CHECKOUT_QUOTE_KEY/,
  );
  // a corrupt draft must degrade to cart mode, not crash checkout
  assert.match(draft, /catch \{[\s\S]*return null/);
});

test("the supplier quote form requires one of their active products", () => {
  assert.match(demand, /respondProductId/);
  assert.match(demand, /\/api\/supplier\/products/);
  // only ACTIVE listings are offered — the API rejects the rest anyway
  assert.match(demand, /\.filter\(\(item\) => item\.status === "ACTIVE"\)/);
  // productId rides along in the POST body (required by the DTO)
  assert.match(demand, /productId: respondProductId/);
  // the send button waits for a product pick as well as a message
  assert.match(
    demand,
    /responding \|\|\s*\n?\s*respondMessage\.trim\(\)\.length === 0 \|\|\s*\n?\s*respondProductId === ""/,
  );
  // own responses show which listing backs them and whether it ordered
  assert.match(demand, /item\.orderId \?/);
  assert.match(demand, /ORDER PLACED/);
});

test("the buyer's accepted quote card offers checkout exactly when convertible", () => {
  // the card is gated on ACCEPTED + product-backed + priced + not yet ordered
  assert.match(
    requests,
    /response\.status === "ACCEPTED" &&\s*\n?\s*response\.productId &&\s*\n?\s*response\.quotedPrice/,
  );
  assert.match(requests, /Proceed to checkout/);
  // an already-converted quote shows the terminal state instead
  assert.match(requests, /response\.orderId \?/);
  assert.match(requests, /^\s+Ordered$/m);
  // clicking writes the draft and hands off to the shared delivery step
  assert.match(requests, /writeCheckoutQuote\(\{/);
  assert.match(requests, /responseId: response\.id/);
  assert.match(requests, /router\.push\("\/checkout\/delivery"\)/);
});

test("the delivery step branches on the quote draft", () => {
  assert.match(delivery, /readCheckoutQuote\(\)/);
  // quote mode skips the cart fetch entirely (empty cart must not bounce)
  assert.match(delivery, /quoteDraft\s+\?\s*Promise\.resolve\(null\)/);
  assert.match(delivery, /!quote && cartItems\.length === 0/);
  // ...but still requires an address
  assert.match(delivery, /const canContinue = quote/);
  // the agreed price is shown before payment
  assert.match(delivery, /agreed price/);
  assert.match(delivery, /Your quote order/);
  // back goes to where quote flow started
  assert.match(delivery, /quote \? "\/requests" : "\/cart"/);
});

test("checkout places through the conversion endpoint in quote mode", () => {
  assert.match(checkout, /readCheckoutQuote\(\)/);
  assert.match(
    checkout,
    /\/api\/product-requests\/responses\/\$\{quote\.responseId\}\/checkout/,
  );
  // cart flow is untouched — same endpoint, same body shape
  assert.match(checkout, /\/api\/cart\/checkout/);
  assert.match(checkout, /deliveryAddressId: selectedAddressId/);
  // quote mode renders one agreed-price line, not supplier groups
  assert.match(checkout, /\{quote \? 1 : orderCount\}/);
  assert.match(checkout, /\(agreed price\)/);
  assert.match(checkout, /Charged at your agreed quote price\./);
  // empty-cart guard is bypassed only for quotes
  assert.match(checkout, /!quote && cartItems\.length === 0/);
  assert.match(checkout, /const canPlace = quote/);
  // placement still clears every draft (quote included)
  assert.match(checkout, /clearCheckoutDraft\(\)/);
});

test("cart entry points always clear a lingering quote draft", () => {
  assert.match(cart, /clearCheckoutQuote\(\)/);
  assert.match(cart, /function continueToDelivery[\s\S]*clearCheckoutQuote/);
  assert.match(shell, /clearCheckoutQuote\(\)/);
  assert.match(
    shell,
    /onCheckout=\{\(\) => \{[\s\S]*clearCheckoutQuote\(\)[\s\S]*router\.push\("\/checkout\/delivery"\)/,
  );
});
