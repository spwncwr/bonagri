import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../app/supplier/page.tsx");
const layout = read("../app/supplier/layout.tsx");
const shell = read("../components/supplier/supplier-shell.tsx");
const panels = read("../components/supplier/dashboard-panels.tsx");
const pageHeading = read("../components/supplier/page-heading.tsx");
const geo = read("../lib/geo.ts");
const tracking = read("../components/transport/location-tracking.tsx");

// Every screen behind the desk's bar. The shared layout owns the shell, so
// none of these may render their own header, guard or chrome — that is what
// used to make the bottom bar disappear.
const deskScreens = {
  "/supplier": "../app/supplier/page.tsx",
  "/supplier/orders": "../app/supplier/orders/page.tsx",
  "/supplier/demand": "../app/supplier/demand/page.tsx",
  "/supplier/disputes": "../app/supplier/disputes/page.tsx",
  "/supplier/products": "../app/supplier/products/page.tsx",
  "/supplier/inventory": "../app/supplier/inventory/page.tsx",
  "/supplier/products/new": "../app/supplier/products/new/page.tsx",
  "/supplier/products/[id]": "../app/supplier/products/[id]/page.tsx",
  "/supplier/settings": "../app/supplier/settings/page.tsx",
};
const ordersPage = read(deskScreens["/supplier/orders"]);
const demandPage = read(deskScreens["/supplier/demand"]);
const disputesPage = read(deskScreens["/supplier/disputes"]);
const settingsPage = read(deskScreens["/supplier/settings"]);

function block(start, end, source = page) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} missing from the supplier dashboard`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} missing after ${start}`);
  return source.slice(from, to);
}

test("the shell wraps every desk screen from the layout, not from each page", () => {
  // one guard + shell for the whole /supplier segment
  assert.match(
    layout,
    /<AuthGuard allowedRoles=\{\["SUPPLIER", "AGRO_DEALER"\]\}>\s*<AttentionProvider/,
  );
  assert.match(
    layout,
    /<SupplierShell vendorRole=\{vendorRole\} attention=\{attention\}>/,
  );
  assert.match(layout, /<\/SupplierShell>[\s\S]*<\/AttentionProvider>\s*<\/AuthGuard>/);

  // no screen may render its own chrome — that is how the bar went missing
  for (const [route, source] of Object.entries(deskScreens)) {
    const file = read(source);
    for (const own of [
      "<AuthGuard",
      "<SupplierShell",
      "<header",
      "min-h-screen bg-[#f6f7f2]",
      "clearAuth",
      "<AppearanceSection",
    ]) {
      assert.equal(file.includes(own), false, `${route} still renders ${own}`);
    }
  }

  // sign-out and the appearance control belong to the shell alone
  assert.match(shell, /clearAuth\(\)/);
  assert.match(shell, /<AppearanceSection /);
});

test("the desk heading never doubles its word while the role loads", () => {
  // roleLabel() answers "Supply desk" for a role that has not resolved yet,
  // and the heading appends " desk" — appending blindly rendered the shell
  // heading as "Supply desk desk" for the first paint of every screen.
  // (The template form below legitimately contains the same characters.)
  assert.doesNotMatch(shell, />\s*\{roleLabel\(vendorRole\)\} desk\s*</);

  // the fallback stands alone until the role is known
  assert.match(
    shell,
    /\{vendorRole \? `\$\{roleLabel\(vendorRole\)\} desk` : "Supply desk"\}/,
  );
  assert.match(shell, /if \(role === "AGRO_DEALER"\) return "Agro dealer";/);
  assert.match(shell, /if \(role === "SUPPLIER"\) return "Supplier";/);
  assert.match(shell, /return "Supply desk";/);
});

test("every shell destination is its own screen, not an anchor jump", () => {
  const hrefs = [...shell.matchAll(/href: "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(
    hrefs.length >= 8,
    "the rail should carry every destination as a route",
  );
  assert.doesNotMatch(shell, /jumpTo|target:/);

  for (const href of hrefs) {
    const route = href === "/" ? "../app/page.tsx" : `../app${href}/page.tsx`;
    assert.ok(
      existsSync(fileURLToPath(new URL(route, import.meta.url))),
      `${href} has no page.tsx behind it`,
    );
  }
});

test("the panels are fed by real counts, not invented figures", () => {
  const stats = block("<KpiCard", "\n              </div>\n\n              <FlowCard");
  assert.match(stats, /value=\{counts\.openOrders\}/);
  assert.match(stats, /value=\{inventory\.length\}/);
  assert.match(stats, /value=\{`R\$\{counts\.deliveredValue\.toLocaleString/);
  assert.match(stats, /value=\{attentionCount\}/);
  // a literal would mean the card was hand-painted for the mock-up
  assert.doesNotMatch(stats, /value=\{?"?\d/);

  const flow = block("<FlowCard", "heroLabel=");
  assert.match(flow, /value: String\(counts\.awaitingPayment\)/);
  assert.match(flow, /counts\.byStatus\["READY_FOR_DELIVERY"\] \?\? 0/);
  assert.match(flow, /value: String\(counts\.delivery\)/);

  // the donut slices come from the delivered/in-progress/cancelled tallies
  const donut = block("<PipelineDonut", "centerLabel=");
  assert.match(donut, /value: counts\.completed/);
  assert.match(donut, /value: counts\.openOrders/);
  assert.match(donut, /value: counts\.cancelled/);

  const health = block("<StockHealthCard", "/>");
  assert.match(health, /lines=\{stockLines\}/);
  assert.match(health, /totalLines=\{inventory\.length\}/);
});

test("the attention figure is shared, not counted twice", () => {
  const memo = block(
    "const attentionCount = useMemo",
    "const coverage = useMemo",
  );
  assert.match(memo, /counts\.awaitingPayment/);
  assert.match(memo, /dispute\.status === "OPEN"/);
  // the dashboard counts once and reports the figure up to the shell
  assert.match(page, /reportAttention\(attentionCount\)/);
  assert.equal(
    [...page.matchAll(/value=\{attentionCount\}/g)].length,
    1,
    "the bell and the card must read from the same memo",
  );
  // the layout holds the badge, so it survives navigation between screens
  assert.match(layout, /const \[attention, setAttention\] = useState\(0\)/);
  assert.match(
    layout,
    /<SupplierShell vendorRole=\{vendorRole\} attention=\{attention\}>/,
  );
});

test("the layout follows the reference split, not the old page flow", () => {
  // rail pinned to the left edge for the full viewport, dark active square
  assert.match(shell, /sticky top-0 hidden h-screen w-\[72px\]/);
  assert.match(shell, /active\s*\n?\s*\? "bg-ink text-page"/);
  assert.match(shell, /href="\/supplier\/settings"[\s\S]*HelpIcon/);

  // the page title lives in the header, with the search pill beside it
  assert.match(shell, /<h1 className="text-xl font-black tracking-tight text-ink">/);
  assert.match(shell, /<SlidersIcon /);
  assert.match(shell, /<SettingsIcon /);
  assert.match(shell, /attention > 0 \?/);

  // analysis stack on the left, one tall map column on the right
  const split = block(
    '<div className="grid items-stretch gap-5 xl:grid-cols-',
    '<div className="grid content-start gap-5" id="insights">',
  );
  assert.match(split, /minmax\(0,1\.55fr\)_minmax\(0,1fr\)/);
  assert.match(panels, /min-h-\[440px\][\s\S]*lg:min-h-0/);

  // 2x2 stat grid beside the tall flow card
  assert.match(page, /md:grid-cols-\[minmax\(0,1\.05fr\)_minmax\(0,1fr\)\]/);
  assert.match(page, /<div className="grid gap-4 sm:grid-cols-2">/);

  // segmented control with counts, then the dark primary action
  const control = block('aria-label="Queue shortcuts"', "</div>\n\n              <Link");
  assert.match(control, /\["DELIVERED", "Delivered", counts\.completed\]/);
  assert.match(control, /\["PENDING", "Pending", counts\.pending\]/);
  // the shortcuts are routes now: each lands on its own preset queue screen
  assert.match(control, /href=\{`\/supplier\/orders\?status=\$\{value\}`\}/);
  assert.match(page, /rounded-full bg-ink px-4 py-2\.5 text-sm font-black text-page/);
});

test("the map column carries the reference's floating chrome", () => {
  assert.match(panels, /zoomControl: false/);
  assert.match(panels, /map\.latLngToContainerPoint/);
  assert.match(panels, /map\.on\("move zoom resize", paint\)/);
  assert.match(panels, /aria-label="Zoom in"/);
  assert.match(panels, /aria-label="Zoom out"/);
  assert.match(panels, /aria-label="Recenter on my deliveries"/);
  assert.match(panels, /aria-label=\{expanded \? "Shrink map" : "Expand map"\}/);
  assert.match(panels, /backdrop-blur/);
  // attribution stays visible even though the default control is off
  assert.match(panels, /openstreetmap\.org\/copyright/);

  // regression: the Leaflet mount must keep a constant className, otherwise
  // React overwrites the classes Leaflet stores on that node
  assert.match(panels, /ref=\{containerRef\} className="h-full w-full"/);
  assert.doesNotMatch(panels, /ref=\{containerRef\} className=\{`/);
  assert.match(panels, /aria-hidden=\{mode !== "map"\}/);
});

test("no reference content was copied into the desk", () => {
  const borrowed = [
    "My Farm",
    "North Fields",
    "Total Plots",
    "Total Crop",
    "Total Area",
    "Total Plants",
    "Soil Health",
    "Farm Performance",
    "Weather",
    "Moisture",
    "Utilization",
    "On Track",
    "Irrigation",
    "Harvesting Tomatoes",
    "plots need attention",
  ];

  for (const phrase of borrowed) {
    for (const [sourceName, source] of [
      ["page", page],
      ["shell", shell],
      ["panels", panels],
    ]) {
      assert.equal(
        source.includes(phrase),
        false,
        `"${phrase}" is the reference's sample copy, not BonAgri's (found in ${sourceName})`,
      );
    }
  }
});

test("coverage is derived from order delivery addresses", () => {
  const coverage = block("const coverage = useMemo", "}, [orders]);");
  assert.match(coverage, /resolvePoint\(/);
  assert.match(coverage, /order\.deliveryAddress\.lat/);
  // only undelivered, live orders belong on the coverage map
  assert.match(
    coverage,
    /status === "CANCELLED" \|\|\s*order\.status === "DELIVERED"/,
  );

  const panel = block("<CoveragePanel", "/>");
  assert.match(panel, /markers=\{coverage\.markers\}/);
  assert.match(panel, /cities=\{coverage\.cities\}/);

  // no fabricated destinations anywhere in the panel component
  assert.doesNotMatch(panels, /\[\s*\{\s*city:/);
});

test("city lookups are shared, not duplicated into the dashboard", () => {
  assert.match(geo, /export const CITY_CENTRES/);
  assert.match(geo, /export function resolvePoint/);
  assert.match(tracking, /import \{ resolvePoint \} from "\.\.\/\.\.\/lib\/geo"/);
  assert.equal(tracking.includes("CITY_CENTRES"), false);
  assert.equal(shell.includes("CITY_CENTRES"), false);
});

test("no new endpoints were invented to support the redesign", () => {
  const sources = {
    dashboard: page,
    orders: ordersPage,
    demand: demandPage,
    disputes: disputesPage,
    settings: settingsPage,
  };
  const known = [
    "/api/disputes/mine",
    "/api/orders/",
    "/api/orders/supplier",
    "/api/product-requests",
    "/api/profile/me",
    "/api/supplier/inventory",
    "/api/supplier/profile",
    "/api/transport/transporters",
  ];
  for (const [name, source] of Object.entries(sources)) {
    const paths = [
      ...source.matchAll(/`\$\{API_BASE_URL\}(\/api\/[^`$]*)/g),
    ].map((match) => match[1]);
    for (const path of paths) {
      assert.ok(
        known.some((prefix) => path.startsWith(prefix.replace(/\/$/, ""))),
        `unexpected endpoint ${path} in ${name}`,
      );
    }
  }
});

test("the queue keeps its lifecycle controls and gains per-status counts", () => {
  const pills = block(
    "-mx-1 flex gap-2 overflow-x-auto",
    "{gateCode ===",
    ordersPage,
  );
  assert.match(pills, /\["READY_FOR_DELIVERY", "Ready"\]/);
  assert.match(pills, /\["OUT_FOR_DELIVERY", "Delivery"\]/);
  assert.match(pills, /counts\.byStatus\[value\]/);
  assert.match(pills, /orders\.length/);
  assert.match(pills, /overflow-x-auto/);
  assert.match(pills, /aria-pressed=\{filter === value\}/);

  // the transitions themselves are untouched
  assert.match(ordersPage, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/status`/);
  assert.match(ordersPage, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/payment`/);
  assert.match(ordersPage, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/delivery\//);
});

test("panels are built on theme tokens so both palettes work", () => {
  assert.match(panels, /bg-\[linear-gradient\(150deg,var\(--theme-success\)/);
  assert.match(panels, /style=\{\{ stroke: `var\(\$\{segment\.colorVar\}\)` \}\}/);
  assert.doesNotMatch(panels, /className="[^"]*\bbg-(emerald|slate|green)-\d/);
  assert.doesNotMatch(shell, /className="[^"]*\bbg-(emerald|slate|green)-\d/);
});

test("every desk screen offers a history-aware back button", () => {
  for (const [route, source] of Object.entries(deskScreens)) {
    assert.match(
      read(source),
      /<PageHeading/,
      `${route} has no PageHeading, so no back button`,
    );
  }

  // the button backs out through history when an in-app screen sits behind
  // it, and pushes a hub on a deep link instead of leaving the app
  assert.match(pageHeading, /goBackOr\(router, fallback\)/);
  assert.match(pageHeading, /ArrowLeftIcon/);
  assert.match(pageHeading, /fallback = "\/supplier"/);

  // the listing forms fall back to the listings screen; the desk root to
  // the marketplace
  assert.match(
    read(deskScreens["/supplier/products/new"]),
    /fallback="\/supplier\/products"/,
  );
  assert.match(
    read(deskScreens["/supplier/products/[id]"]),
    /fallback="\/supplier\/products"/,
  );
  assert.match(page, /<PageHeading title="Dashboard" fallback="\/" \/>/);
});

test("URL presets suspend behind Suspense and search lives on the queue screen", () => {
  // a production build fails if a useSearchParams reader is not suspended
  for (const [name, source] of [
    ["orders", ordersPage],
    ["demand", demandPage],
  ]) {
    assert.match(source, /useSearchParams\(/, `${name} does not read its preset`);
    assert.match(
      source,
      /export default function \w+Page\(\) \{\s*return \(\s*<Suspense/,
      `${name} needs a Suspense boundary around its preset reader`,
    );
  }

  // the queue screen owns the search box the shell used to carry
  assert.match(ordersPage, /aria-label="Search the order queue"/);
  assert.doesNotMatch(shell, /Search the order queue|SearchIcon/);

  // dashboard shortcuts deep-link into the separate screens
  assert.match(page, /\/supplier\/orders\?status=/);
  assert.match(page, /\/supplier\/demand\?respond=/);
});
