import type { NextConfig } from "next";

// HP6 (plan G6): response security headers for every route.
//
// The plan starts the CSP report-only and tightens it after a browser pass.
// Pass A (report-only: marketplace, external images, checkout, invoice —
// zero violations, zero console errors) came back green, so this ships the
// ENFORCED header; pass B re-ran the same journey against it with a clean
// console as the gate. HSTS/XFO/Referrer/Permissions shipped enforcing from
// the start (they cannot break app flows).

const CSP_HEADER_KEY =
  "Content-Security-Policy" as
    | "Content-Security-Policy"
    | "Content-Security-Policy-Report-Only";

// The API is a separate origin (localhost:3000 → Render in prod), so
// connect-src must name it explicitly. Read from the build-time env with the
// local fallback — media.ts uses the same variable + fallback.
const API_ORIGIN = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000"
).replace(/\/+$/, "");

// Source inventory behind these allowances (HP6 investigation):
// - scripts/styles/fonts: Next App Router hydration emits INLINE scripts →
//   'unsafe-inline' on script-src (a nonce needs middleware — noted as
//   residue in the progress log); Geist fonts are self-hosted via next/font.
// - images: plain <img> via buildImageUrl → res.cloudinary.com, Leaflet
//   tiles → tile.openstreetmap.org, blob:/data: for upload previews — and
//   the external-paste fallback ("…or paste an image URL" in the promotion
//   form) stores arbitrary https URLs, so img-src keeps a broad https:
//   source alongside the pinned hosts.
// - connect: our API, Cloudinary direct uploads (bytes never transit the
//   API), Nominatim reverse-geocoding and OSRM routing used by the location
//   components. google.com/maps/dir links are plain navigations — CSP
//   does not apply to them.
// - geolocation: location-picker / location-tracking / promotion-feed need
//   it → Permissions-Policy allows self only; camera/mic/payment stay off.
// - no iframes anywhere → frame-ancestors 'none' (+ X-Frame-Options DENY).
// Inline scripts/styles are Next's hydration payload + React style attrs.
// 'unsafe-eval' is DEV-ONLY: React's development build needs eval() for its
// debugging features (pass B hit exactly this under enforcement); the
// production build never evals, so the shipped policy stays strict.
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://res.cloudinary.com https://tile.openstreetmap.org https:",
  `connect-src 'self' ${API_ORIGIN} https://api.cloudinary.com https://nominatim.openstreetmap.org https://router.project-osrm.org`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route (pages, RSC responses, _next assets alike).
        source: "/:path*",
        headers: [
          { key: CSP_HEADER_KEY, value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
          // 180 days with subdomains: harmless on plain-http localhost
          // (browsers ignore HSTS over http), enforced on the https prod
          // origin. includeSubDomains is safe here — every subdomain of the
          // web host is served over TLS too.
          {
            key: "Strict-Transport-Security",
            value: "max-age=15552000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
