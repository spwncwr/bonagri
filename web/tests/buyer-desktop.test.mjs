import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const shell = read("../components/marketplace/home-shell.tsx");
const header = read("../components/mobile/app-header.tsx");
const sidebar = read("../components/marketplace/buyer-sidebar.tsx");
const card = read("../components/mobile/product-card.tsx");

function block(start, end, source = shell) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} missing from the buyer shell`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} missing after ${start}`);
  return source.slice(from, to);
}

test("the desktop pane is mounted beside the shopping column", () => {
  assert.match(shell, /import BuyerSidebar from "\.\/buyer-sidebar"/);
  // the sidebar sits between the header and the content column, never inside
  // a mobile-only branch
  const wrapper = block("lg:flex lg:items-start lg:gap-6", "<BuyerSidebar");
  assert.match(wrapper, /appMode && !selectedProduct/);
  assert.match(
    shell,
    /<BuyerSidebar[\s\S]*?onPickCategory=\{pickCategory\}/,
  );
  assert.match(
    shell,
    /"lg:min-w-0 lg:flex-1 lg:self-stretch lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden"/,
  );
});

test("the desktop shell pins the page so only the listings scroll", () => {
  // The buyer shell (and only it) becomes a viewport-height flex column at
  // lg: header in flow, wrapper filling the rest, page overflow clipped —
  // phones and guests keep min-h-screen page scrolling untouched.
  assert.match(
    shell,
    /" pb-24 lg:pb-0 lg:flex lg:flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden"/,
  );
  // The wrapper must be allowed to shrink to the leftover height, otherwise
  // its content would be clipped by the shell's overflow-hidden.
  assert.match(
    shell,
    /"mx-auto w-full max-w-\[1600px\] lg:flex lg:items-start lg:gap-6 lg:px-6 lg:flex-1 lg:min-h-0"/,
  );
  // View/product switches reset the column scroll next to the window scroll.
  const resets = shell.match(
    /contentColumnRef\.current\?\.scrollTo\(\{ top: 0/g,
  );
  assert.equal(
    resets?.length,
    4,
    "goTo (both branches), showProduct and closeProduct reset",
  );
  assert.match(
    shell,
    /contentColumnRef\.current\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/,
    "same-tab navigation scrolls the column smoothly",
  );
  // The footer moves into the column for buyers, but guests keep it after
  // their marketing close-out — one shared definition, both placements.
  assert.match(shell, /function SiteFooter\(/);
  assert.match(
    shell,
    /\{!appMode \? \(\s*<SiteFooter view=\{view\} selectedProduct=\{selectedProduct\} role=\{currentUser\?\.role\} \/>/,
  );
  assert.match(
    shell,
    /\{appMode \? \(\s*<SiteFooter view=\{view\} selectedProduct=\{selectedProduct\} role=\{currentUser\?\.role\} \/>/,
  );
});

test("the sidebar is desktop-only and reuses existing destinations", () => {
  assert.match(
    sidebar,
    /className="sticky[^"]*hidden[^"]*lg:flex"/,
    "the pane must stay hidden until lg",
  );
  assert.doesNotMatch(sidebar, /fetch\(/, "the pane must not invent a data source");

  for (const href of ["/requests", "/addresses", "/settings"]) {
    assert.ok(
      sidebar.includes(`"${href}"`),
      `${href} should be a real sidebar destination`,
    );
    assert.ok(
      shell.includes(`href="${href}"`) ||
        read(`../app/${href.slice(1)}/page.tsx`).length > 0,
      `${href} has no page`,
    );
  }

  for (const view of ["home", "explore", "cart", "orders", "profile"]) {
    assert.ok(
      sidebar.includes(`"${view}"`),
      `the ${view} view should be reachable from the pane`,
    );
  }
});

test("the sidebar categories come from the marketplace's own category list", () => {
  assert.match(
    shell,
    /categories=\{CATEGORY_CARDS\.map\(\(\[name\]\) => name\)\}/,
    "the pane must reuse the category pills' source, not a new list",
  );
  assert.match(sidebar, /getCategoryIcon\(name\)/);
});

test("product columns flex with the container instead of a fixed count", () => {
  const flexible =
    /lg:grid-cols-\[repeat\(auto-fill,minmax\(210px,1fr\)\)\]/g;
  const grids = shell.match(flexible) ?? [];
  assert.equal(
    grids.length,
    2,
    "both buyer-feed grids should use the auto-fill strategy",
  );
});

test("the phone feed keeps its original grid and containers", () => {
  // mobile regression guard: the base (pre-lg) classes are untouched
  assert.match(shell, /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-\[/);
  assert.match(shell, /max-w-2xl px-4 pb-6 lg:max-w-none lg:px-0/);
  assert.match(shell, /max-w-2xl space-y-5 px-4 pt-4 lg:max-w-none/);
  assert.match(shell, /max-w-2xl px-4 pt-4 lg:max-w-none/);
});

test("the bottom tab bar steps aside for the desktop pane", () => {
  assert.match(shell, /<div className="lg:hidden">\s*<TabBar/);
  assert.match(
    shell,
    /" pb-24 lg:pb-0 lg:flex lg:flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden"/,
  );
});

test("the header only changes at lg", () => {
  assert.match(header, /lg:contents/);
  assert.match(header, /lg:order-2/);
  assert.match(header, /max-w-2xl px-4 pt-3 lg:flex/);

  // every new piece of desktop chrome is display-none until lg
  assert.match(header, /className="hidden items-center gap-2 rounded-xl[^"]*lg:flex"/);
  assert.match(header, /className="relative hidden lg:block"/);
  assert.match(header, /hidden shrink-0 rounded-full bg-\[#17633a\][^"]*lg:block/);
  assert.match(header, /mt-3 hidden border-t border-line lg:block/);

  // the phone header's own pieces are still there, unchanged
  assert.match(header, /"mt-3 lg:order-2 lg:mt-0/);
  assert.match(header, /rounded-full border border-\[#d5ddd3\] bg-white text-\[#344238\] transition/);
});

test("the product card was not redesigned", () => {
  assert.match(card, /className="flex flex-col transition active:scale-\[0\.985\]"/);
  assert.match(card, /aspect-square overflow-hidden rounded-2xl/);
  assert.match(card, /w-full rounded-xl bg-\[#17633a\] py-2\.5 text-xs font-black/);
});

test("posting a product request is a buyer-only surface", () => {
  // The home demand section renders for buyers alone — never for guests or
  // the supplier/admin/transporter consoles.
  const demand = block(
    'currentUser?.role === "BUYER" && view === "home"',
    "</section>",
  );
  assert.match(demand, /Post a product request/);
  assert.equal(
    (demand.match(/router\.push\("\/requests"\)/g) ?? []).length,
    3,
    "every CTA in the section deep-links to /requests",
  );
  assert.doesNotMatch(
    demand,
    /promptSignIn|role === "SUPPLIER"/,
    "no guest prompt or supplier branch left inside the buyer-only section",
  );

  // The footer anchor follows the same rule.
  assert.match(
    shell,
    /role === "BUYER" && view === "home" \? \(\s*<a href="#requests"/,
  );

  // Sidebar and profile menu rows are filtered by role too.
  assert.match(
    sidebar,
    /item\.key !== "requests" \|\| user\?\.role === "BUYER"/,
  );
  const profile = read("../components/mobile/profile-screen.tsx");
  block('user.role === "BUYER" ?', 'label="Product requests"', profile);

  // The promo carousel drops every /requests slide for non-buyers, and both
  // placements pass the buyer flag.
  const promo = read("../components/mobile/promo-carousel.tsx");
  assert.match(promo, /!slide\.href\.startsWith\("\/requests"\)/);
  assert.equal(
    (shell.match(/showRequestSlide=\{currentUser\?\.role === "BUYER"\}/g) ?? [])
      .length,
    2,
    "both carousel placements pass the buyer flag",
  );

  // Direct deep links stay behind the page-level guard.
  const requestsPage = read("../app/requests/page.tsx");
  assert.match(requestsPage, /AuthGuard allowedRoles=\{\["BUYER"\]\}/);
});
