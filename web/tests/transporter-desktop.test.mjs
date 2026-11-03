import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const page = read("../app/transport/page.tsx");
const panels = read("../components/transport/transport-panels.tsx");
const liveMap = read("../components/transport/live-map.tsx");
const tracking = read("../components/transport/location-tracking.tsx");

function block(start, end, source = page) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `${start} missing from the transport desk`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `${end} missing after ${start}`);
  return source.slice(from, to);
}

test("the desk chrome only exists from lg upwards", () => {
  assert.match(
    panels,
    /className="sticky top-0 hidden h-screen w-\[72px\][^"]*lg:flex"/,
    "the rail must stay hidden until lg",
  );
  assert.match(
    panels,
    /className="sticky top-0 z-30 hidden border-b border-line[^"]*lg:block"/,
    "the header must stay hidden until lg",
  );
  assert.match(page, /className="hidden lg:block"/, "the desk branch is lg-only");
});

test("every phone branch is preserved and only hidden at lg", () => {
  for (const view of ["home", "jobs", "deliveries", "profile"]) {
    assert.match(
      page,
      new RegExp(`\\{tab === "${view}" && \\(\\s*<div className="lg:hidden">`),
      `${view} tab must keep its own phone layout`,
    );
  }

  // the phone shell keeps its original container classes
  assert.match(
    page,
    /className="relative z-10 mx-auto max-w-md min-h-screen px-4 pb-28 lg:max-w-none lg:px-6 lg:pb-12"/,
  );
  // the fixed tab bar is still the only mobile navigation
  assert.match(page, /<div className="lg:hidden">\s*<TransportTabBar/);
});

test("the desk reuses the existing endpoints and adds no queries", () => {
  const urls = [
    ...new Set(
      [...page.matchAll(/`\$\{API_BASE_URL\}(\/api\/[^`]*)`/g)]
        .map((match) => match[1].replace(/\$\{[^}]*\}/g, ":id"))
        .sort(),
    ),
  ];

  assert.deepEqual(urls, [
    "/api/orders/:id/delivery/:id",
    "/api/orders/:id/delivery/fail",
    "/api/transport/deliveries",
    "/api/transport/jobs",
    "/api/transport/jobs/:id/claim",
  ]);
  assert.doesNotMatch(panels, /fetch\(/, "panels must not invent a data source");
});

test("the rail only carries destinations the hub already has", () => {
  const rail = block("Desktop icon rail", "Desktop header bar", panels);
  const keys = [...rail.matchAll(/key: "([a-z]+)"/g)].map((match) => match[1]);

  assert.deepEqual(keys, ["home", "jobs", "deliveries", "profile"]);
  assert.match(rail, /href="\/"/, "the marketplace link is the existing root route");
  assert.doesNotMatch(rail, /href="\/(settings|orders|admin)/, "no invented routes");
});

test("desk components speak in theme tokens, not the reference palette", () => {
  const desk = block("Desktop icon rail", "Desktop section card", panels);
  assert.equal(
    /#[0-9a-f]{3,8}/i.test(desk),
    false,
    "the desktop branch must not hardcode colours",
  );
  assert.match(desk, /bg-surface/);
  assert.match(desk, /border-line/);
  assert.match(desk, /text-ink/);

  // status chips on the desk come from the token map, mobile keeps its own
  assert.match(panels, /STATUS_TONE: Record<Delivery\["status"\], string>/);
  assert.match(panels, /ASSIGNED: "bg-warning-soft text-warning-bright"/);
});

test("desk statistics are computed from loaded deliveries, never hardcoded", () => {
  assert.match(page, /value=\{jobs\.length\}/);
  assert.match(page, /value=\{active\.length\}/);
  assert.match(page, /value=\{completedCount\}/);
  assert.match(page, /value=\{failedCount\}/);
  assert.match(
    page,
    /const completedCount = history\.filter\(\s*\(delivery\) => delivery\.status === "DELIVERED",/,
  );
});

test("filters and focus are client-side over the rows already loaded", () => {
  assert.match(page, /const deskActive = active\.filter\(deskMatches\);/);
  assert.match(page, /const deskHistory = history\.filter\(deskMatches\);/);
  assert.match(
    page,
    /const deskFocused =\s*active\.find\(\(delivery\) => delivery\.orderId === focusedId\)/,
  );
  // the tracking card labels the date field it actually has
  assert.match(panels, /label: "Completed", at: delivery\.deliveredAt/);
  assert.match(panels, /label: "Failed", at: delivery\.failedAt/);
});

test("the route panel reuses LiveMap without disturbing the phone overlay", () => {
  assert.match(
    panels,
    /<LiveMap[\s\S]*?topInsetPx=\{24\}[\s\S]*?bottomInsetRatio=\{0\.08\}/,
  );
  // defaults keep the mobile framing byte-identical
  assert.match(liveMap, /topInsetPx = 96/);
  assert.match(liveMap, /bottomInsetRatio = 0\.63/);
  assert.doesNotMatch(
    tracking,
    /topInsetPx|bottomInsetRatio/,
    "the tracking overlay must not pass desk insets",
  );
});

test("the desk keeps the existing delivery actions wired to the same handlers", () => {
  assert.match(page, /onOpen=\{openDesk\}/);
  assert.match(page, /setSelectedDelivery\(delivery\)/);
  assert.match(page, /setTrackedDelivery\(delivery\)/);
  assert.match(page, /onClaim=\{\(\) => void claimJob\(job\)\}/);
  assert.match(
    page,
    /const openDesk = \(delivery: Delivery\) => \{\s*setFocusedId\(delivery\.orderId\);\s*setSelectedDelivery\(delivery\);/,
  );
});

test("shared delivery language moved out of the page without duplicating it", () => {
  assert.equal(page.includes("function ProgressStepper"), false);
  assert.equal(page.includes("const STATUS_CHIP"), false);
  assert.match(panels, /export function ProgressStepper/);
  assert.match(panels, /export const STATUS_CHIP/);
  // the mobile cards still render the same stepper and chips
  assert.match(page, /<ProgressStepper status=\{featured\.status\} \/>/);
  assert.match(page, /<ProgressStepper status=\{delivery\.status\} \/>/);
});
