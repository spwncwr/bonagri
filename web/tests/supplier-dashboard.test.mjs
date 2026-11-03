import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../app/supplier/page.tsx");
const shell = read("../components/supplier/supplier-shell.tsx");
const panels = read("../components/supplier/dashboard-panels.tsx");
const geo = read("../lib/geo.ts");
const tracking = read("../components/transport/location-tracking.tsx");

function block(start, end, source = page) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} missing from the supplier dashboard`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} missing after ${start}`);
  return source.slice(from, to);
}

test("the dashboard is mounted inside the supplier shell, not its own header", () => {
  assert.match(
    page,
    /<AuthGuard allowedRoles=\{\["SUPPLIER", "AGRO_DEALER"\]\}>\s*<SupplierShell/,
  );
  assert.match(page, /<\/SupplierShell>\s*<\/AuthGuard>/);
  assert.equal(page.includes("min-h-screen bg-[#f6f7f2]"), false);
  // sign-out and the appearance control now belong to the shell alone
  assert.equal(page.includes("clearAuth"), false);
  assert.equal(page.includes("<AppearanceSection"), false);
  assert.match(shell, /clearAuth\(\)/);
  assert.match(shell, /<AppearanceSection /);
});

test("every shell destination has a section on the page", () => {
  const ids = [...shell.matchAll(/jumpTo\("([a-z]+)"\)|target: "([a-z]+)"/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
  const unique = [...new Set(ids)];
  assert.ok(unique.length >= 3, "the rail is expected to carry jump targets");

  for (const id of unique) {
    assert.match(
      page,
      new RegExp(`id="${id}"[\\s\\S]{0,120}scroll-mt-28`),
      `section #${id} is missing or cannot be scrolled to under the sticky header`,
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
  assert.match(page, /attention=\{attentionCount\}/);
  assert.equal(
    [...page.matchAll(/value=\{attentionCount\}/g)].length,
    1,
    "the bell and the card must read from the same memo",
  );
});

test("the layout follows the reference split, not the old page flow", () => {
  // rail pinned to the left edge for the full viewport, dark active square
  assert.match(shell, /sticky top-0 hidden h-screen w-\[72px\]/);
  assert.match(shell, /active\s*\n?\s*\? "bg-ink text-page"/);
  assert.match(shell, /href="\/settings"[\s\S]*HelpIcon/);

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
  assert.match(control, /setFilter\(filter === value \? "ALL" : value\)/);
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
  const paths = [...page.matchAll(/`\$\{API_BASE_URL\}(\/api\/[^`$]*)/g)].map(
    (match) => match[1],
  );
  const known = [
    "/api/disputes/mine",
    "/api/orders/",
    "/api/orders/supplier",
    "/api/product-requests",
    "/api/supplier/inventory",
    "/api/transport/transporters",
  ];
  for (const path of paths) {
    assert.ok(
      known.some((prefix) => path.startsWith(prefix.replace(/\/$/, ""))),
      `unexpected endpoint ${path}`,
    );
  }
});

test("the queue keeps its lifecycle controls and gains per-status counts", () => {
  const pills = block('id="queue"', "{error &&");
  assert.match(pills, /\["READY_FOR_DELIVERY", "Ready"\]/);
  assert.match(pills, /\["OUT_FOR_DELIVERY", "Delivery"\]/);
  assert.match(pills, /counts\.byStatus\[value\]/);
  assert.match(pills, /orders\.length/);
  assert.match(pills, /overflow-x-auto/);
  assert.match(pills, /aria-pressed=\{filter === value\}/);

  // the transitions themselves are untouched
  assert.match(page, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/status`/);
  assert.match(page, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/payment`/);
  assert.match(page, /`\$\{API_BASE_URL\}\/api\/orders\/\$\{orderId\}\/delivery\//);
});

test("panels are built on theme tokens so both palettes work", () => {
  assert.match(panels, /bg-\[linear-gradient\(150deg,var\(--theme-success\)/);
  assert.match(panels, /style=\{\{ stroke: `var\(\$\{segment\.colorVar\}\)` \}\}/);
  assert.doesNotMatch(panels, /className="[^"]*\bbg-(emerald|slate|green)-\d/);
  assert.doesNotMatch(shell, /className="[^"]*\bbg-(emerald|slate|green)-\d/);
});
