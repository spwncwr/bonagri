import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const drawer = read("../components/cart/cart-drawer.tsx");
const shell = read("../components/marketplace/home-shell.tsx");
const header = read("../components/mobile/app-header.tsx");
const cartScreen = read("../components/mobile/cart-screen.tsx");

// The drawer sits between the shell's JSX markers so we can assert on just
// the mounted block (the shell is a huge file).
function drawerMount(source = shell) {
  const from = source.indexOf("<CartDrawer");
  assert.notEqual(from, -1, "<CartDrawer is not mounted in the shell");
  const end = source.indexOf("/>", from);
  assert.notEqual(end, -1, "CartDrawer mount is self-closing");
  return source.slice(from, end);
}

test("the drawer is a controlled component fed by the shell's cart state", () => {
  assert.match(drawer, /import type \{ CartScreenItem \} from "\.\.\/mobile\/cart-screen"/);
  // props surface
  for (const prop of [
    "open: boolean",
    "items: CartScreenItem[]",
    "error: string",
    "loading: boolean",
    "busy: boolean",
    "onPatch:",
    "onRemove:",
    "onClose:",
    "onViewCart:",
    "onCheckout:",
  ]) {
    assert.ok(drawer.includes(prop), `missing prop declaration: ${prop}`);
  }

  const mount = drawerMount();
  assert.match(mount, /items=\{cartItems\}/);
  assert.match(mount, /onPatch=\{patchCartItem\}/);
  assert.match(mount, /onRemove=\{removeCartItem\}/);
  assert.match(mount, /error=\{cartError\}/);
  assert.match(mount, /loading=\{!cartLoaded\}/);
  assert.match(mount, /busy=\{cartUpdating \|\| addingToCart\}/);
});

test("the drawer issues no requests of its own", () => {
  assert.ok(!/fetch\(/.test(drawer), "drawer must not fetch on its own");
  assert.ok(
    !/useRouter|next\/navigation/.test(drawer),
    "navigation stays in the shell (existing flows only)",
  );
  // No new dependencies: react + local icons + the existing cart type only.
  const sources = [...drawer.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sources.length >= 3, "expected the drawer's imports");
  for (const source of sources) {
    assert.ok(
      ["react", "../mobile/icons", "../mobile/cart-screen"].includes(source),
      `unexpected import source: ${source}`,
    );
  }
});

test("the header cart icon opens the drawer only on desktop (lg+)", () => {
  const from = shell.indexOf("onCart={() => {");
  assert.notEqual(from, -1, "AppHeader onCart handler missing");
  const handler = shell.slice(from, shell.indexOf("onToggleNotifications", from));

  assert.match(handler, /min-width: 1024px/, "desktop gate missing");
  assert.match(handler, /setCartOpen\(true\)/);
  // mobile fallback keeps the existing full-cart navigation
  assert.match(handler, /goTo\("cart"\)/);

  // the existing desktop header icon is untouched (no second cart icon added)
  assert.match(header, /aria-label=\{`Open cart, \$\{cartCount\} items`\}/);
});

test("the drawer closes itself when the viewport drops below lg", () => {
  assert.match(drawer, /max-width: 1023px/, "mobile self-close listener missing");
  assert.match(drawer, /mobile\.addEventListener\("change"/);
});

test("the legacy cart overlay was replaced, not duplicated", () => {
  assert.ok(!/z-\[70\]/.test(shell), "old overlay markup still present");
  assert.ok(
    !/aria-label="Shopping cart"/.test(shell),
    "old inline dialog still present",
  );
  // navigating away closes the drawer
  const goTo = shell.slice(
    shell.indexOf("function goTo("),
    shell.indexOf("function goTo(") + 700,
  );
  assert.match(goTo, /setCartOpen\(false\)/);
});

test("close paths: button, outside click and Escape", () => {
  assert.match(drawer, /onClick=\{onClose\}/, "backdrop/outside click");
  assert.match(
    drawer,
    /onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
    "panel must swallow inner clicks",
  );
  assert.match(drawer, /event\.key === "Escape"\)/, "Escape handling");
  assert.match(drawer, /aria-label="Close cart"/, "close button");
});

test("the page behind the drawer is locked and restored", () => {
  assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
  assert.match(drawer, /document\.body\.style\.overflow = previousOverflow/);
});

test("slide animation and independent inner scrolling", () => {
  assert.match(drawer, /translate-x-full/, "closed position");
  assert.match(drawer, /translate-x-0/, "open position");
  assert.match(drawer, /transition-transform duration-300/, "transition");
  assert.match(drawer, /transition-opacity duration-300/, "backdrop fade");

  const scroll = drawer.indexOf('className="flex-1 overflow-y-auto');
  assert.notEqual(scroll, -1, "inner scroll region missing");
  const summary = drawer.indexOf("border-t border-line bg-surface px-5 py-4");
  assert.notEqual(summary, -1, "summary block missing");
  // the summary + actions live outside the scroll region (pinned to the
  // bottom while the items scroll above them)
  assert.ok(summary > scroll, "summary must come after the scroll region");
});

test("the drawer only uses semantic theme tokens", () => {
  assert.ok(!/bg-white/.test(drawer), "bg-white leaks light-only styling");
  assert.ok(!/(text|bg|border)-\[#/.test(drawer), "raw hex class in drawer");
  assert.ok(!/#(?:[0-9a-fA-F]{3}){1,2}\b/.test(drawer), "raw hex value");
  for (const token of [
    "bg-surface",
    "text-ink",
    "text-ink-muted",
    "text-ink-faint",
    "bg-surface-raised",
    "border-line",
    "text-success-bright",
    "bg-danger-soft",
    "text-danger-bright",
    "bg-brand",
    "text-brand-ink",
  ]) {
    assert.ok(drawer.includes(token), `missing theme token: ${token}`);
  }
});

test("totals reuse the existing cart maths and invent nothing", () => {
  assert.match(drawer, /Number\(item\.lineTotal\)/, "totals from lineTotal");
  // no fabricated charges anywhere in the drawer (comments stripped first —
  // the header comment is allowed to say the word "discounts")
  const code = drawer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/delivery fee|shipping|discount|coupon|voucher|GST|service fee/i.test(
      code,
    ),
    "invented fee/discount line detected",
  );
  // the full cart page keeps its own identical total logic (unchanged)
  assert.match(cartScreen, /sum \+ Number\(item\.lineTotal\)/);
});

test("empty cart state uses the existing icon and a way back", () => {
  assert.match(drawer, /BasketIcon/, "existing cart icon asset");
  assert.match(drawer, /Your cart is empty/);
  const emptyStart = drawer.indexOf("Your cart is empty");
  const emptyBlock = drawer.slice(emptyStart, emptyStart + 800);
  assert.match(emptyBlock, /onClick=\{onClose\}/, "Continue shopping closes");
  assert.ok(
    !/R\d/.test(drawer.slice(emptyStart - 400, emptyStart)),
    "no placeholder prices before the empty state",
  );
});

test("loading and error states are handled", () => {
  assert.match(drawer, /loading && items\.length === 0/, "skeleton gate");
  assert.match(drawer, /animate-pulse/, "loading skeleton");
  assert.match(drawer, /Some items are out of stock/, "stock warning");
  assert.match(drawer, /error \|\| !allInStock/, "error surfaced in summary");
});

test("duplicate actions are blocked while a cart update is in flight", () => {
  // synchronous ref guard in the shell (protects same-tick double clicks)
  assert.equal(
    (shell.match(/if \(cartUpdatingRef\.current\) return;/g) ?? []).length,
    2,
    "both patch and remove must be guarded",
  );
  assert.match(shell, /cartUpdatingRef\.current = true;/);
  assert.match(shell, /setCartUpdating\(false\);/);
  // and the drawer disables its controls on busy
  const busyUses = (drawer.match(/disabled=\{busy \|\|/g) ?? []).length;
  assert.ok(busyUses >= 2, "steppers/remove must respect busy");
  assert.match(drawer, /checkoutDisabled/, "checkout guarded too");
});

test("failed updates re-sync so totals never go stale", () => {
  const patch = shell.slice(
    shell.indexOf("async function patchCartItem"),
    shell.indexOf("async function removeCartItem"),
  );
  assert.match(patch, /catch \(error\)/);
  assert.match(patch, /await loadCart\(\);/, "reload after failure");
});

test("checkout and full cart reuse the existing flows", () => {
  const mount = drawerMount();
  assert.match(mount, /goTo\("cart"\)/, "View full cart -> existing view");
  assert.match(mount, /router\.push\("\/checkout"\)/, "existing checkout route");
  assert.ok(
    !/\/checkout/.test(drawer),
    "drawer itself must not hardcode routes",
  );
});

test("mobile cart experience is untouched", () => {
  // the full cart screen still renders with its own navigation intact
  assert.match(cartScreen, /export default function CartScreen/);
  assert.match(cartScreen, /router\.push\("\/checkout"\)/);
  // AppHeader still takes a single onCart callback (mobile path unchanged)
  assert.match(header, /onCart: \(\) => void;/);
});
