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
  assert.match(shell, /"lg:min-w-0 lg:flex-1"/);
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
  assert.match(shell, /" pb-24 lg:pb-16"/);
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
