// HP6 (plan G6): pin the security headers next.config.ts serves.
//
// The config is imported directly (Node >= 22.18 strips types natively), so
// this asserts the real header array rather than grepping the source.

import test from "node:test";
import assert from "node:assert/strict";

// Deterministic connect-src: pin the API origin the same way a production
// build sees it via NEXT_PUBLIC_API_BASE_URL. NODE_ENV pins the PRODUCTION
// policy — what `next build` ships (dev adds 'unsafe-eval' for React's
// debugging features; pass B exercised that branch live).
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.test.example";
process.env.NODE_ENV = "production";

const { default: nextConfig } = await import("../next.config.ts");

const rules = await nextConfig.headers();
const allRoutes = rules.find((rule) => rule.source === "/:path*");
assert.ok(allRoutes, "headers() must cover every route via /:path*");

const headers = Object.fromEntries(
  allRoutes.headers.map((header) => [header.key.toLowerCase(), header.value]),
);

// The plan's header set — exact keys, nothing missing. The CSP ships
// ENFORCED (flipped after pass A went green).
assert.deepEqual(
  Object.keys(headers).sort(),
  [
    "content-security-policy",
    "permissions-policy",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
  ].sort(),
);

test("clickjacking + content sniffing + referrer", () => {
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
});

test("HSTS pinned (180 days, subdomains)", () => {
  assert.equal(
    headers["strict-transport-security"],
    "max-age=15552000; includeSubDomains",
  );
});

test("Permissions-Policy: geolocation for self only, no camera/mic/payment", () => {
  assert.equal(
    headers["permissions-policy"],
    "geolocation=(self), camera=(), microphone=(), payment=()",
  );
});

test("CSP ships enforced after the green browser passes (HP6)", () => {
  assert.ok(
    "content-security-policy" in headers,
    "expected the enforcing CSP header (report-only flipped after pass A)",
  );
  assert.ok(!("content-security-policy-report-only" in headers));
});

test("CSP pins the external origins the app actually uses", () => {
  const csp = headers["content-security-policy"];

  // Sources, not just substrings — pin per directive.
  const directive = (name) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1);

  // Images: Cloudinary CDN + Leaflet tiles pinned, plus https: for the
  // documented external-paste fallback ("…or paste an image URL").
  const imgSrc = directive("img-src");
  assert.ok(imgSrc.includes("https://res.cloudinary.com"));
  assert.ok(imgSrc.includes("https://tile.openstreetmap.org"));
  assert.ok(imgSrc.includes("https:"));
  assert.ok(imgSrc.includes("blob:"));

  // Connect: our API (env value), Cloudinary direct upload, Nominatim, OSRM.
  const connectSrc = directive("connect-src");
  assert.ok(connectSrc.includes("https://api.test.example"));
  assert.ok(connectSrc.includes("https://api.cloudinary.com"));
  assert.ok(connectSrc.includes("https://nominatim.openstreetmap.org"));
  assert.ok(connectSrc.includes("https://router.project-osrm.org"));

  // Inline scripts/styles are Next's hydration payload + React style attrs.
  assert.equal(directive("script-src"), "'self' 'unsafe-inline'");
  assert.equal(directive("style-src"), "'self' 'unsafe-inline'");

  // No eval, no framing, no plugins.
  assert.ok(!csp.includes("unsafe-eval"));
  assert.equal(directive("frame-ancestors"), "'none'");
  assert.equal(directive("object-src"), "'none'");
});
