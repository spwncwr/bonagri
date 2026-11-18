import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";

// HP6 (plan G6): the API's CORS allowlist and response-hardening headers,
// pulled out of main.ts so unit tests can exercise exactly what production
// serves. (The e2e suite boots AppModule without main.ts, so wiring that
// lives only in main.ts could never be asserted.)

/**
 * Deduped CORS allowlist: `CORS_ORIGIN` (comma separated) ∪ `WEB_BASE_URL`
 * (the deployed frontend). An environment that sets neither falls back to
 * the local dev web origin.
 */
export function resolveCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const corsOrigins = (env.CORS_ORIGIN ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const webOrigins = (env.WEB_BASE_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set([...corsOrigins, ...webOrigins])];
}

/**
 * CORS + helmet for the JSON API.
 *
 * Investigation note (HP6): this repo carries no reverse-proxy/edge config
 * (no render.yaml, no proxy middleware) — the deployed chain is
 * client → Cloudflare edge → Render router → instance, and those hops pass
 * response headers through unchanged without adding any of their own.
 * helmet here is therefore the only layer; nothing double-handles these
 * headers. Health stays unthrottled (CP13) — rate limiting is unrelated to
 * this wiring and untouched.
 */
export function applySecurity(app: INestApplication): void {
  // HP5: the refresh cookie makes auth a credentialed cross-origin flow —
  // the browser only attaches it when CORS echoes an EXACT allowlisted
  // origin with credentials enabled. A foreign origin receives no
  // Access-Control-Allow-Origin at all, so the browser blocks the response
  // (and preflights fail the same way).
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
  });

  app.use(
    helmet({
      // helmet removes Express's default X-Powered-By header by default —
      // it advertises the framework for no benefit.
      // API responses are consumed by the web app on ANOTHER origin
      // (localhost:3001 → :3000 in dev; web origin → Render API in prod),
      // so helmet's default same-origin CORP would be wrong here.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // The API serves JSON only — no documents, scripts, styles, images or
      // fonts — so its policy can be stricter than any HTML app's.
      // frame-ancestors 'none' + X-Frame-Options DENY stop the API being
      // framed; useDefaults:false keeps helmet's boilerplate (e.g.
      // upgrade-insecure-requests, which would be meaningless noise on a
      // plain-http dev origin) out of the header.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'none'"],
          imgSrc: ["'none'"],
          fontSrc: ["'none'"],
        },
      },
      // 180 days, host-only: production serves over TLS (Cloudflare/Render
      // terminate it) and browsers ignore HSTS on plain-http dev origins.
      strictTransportSecurity: {
        maxAge: 15_552_000,
        includeSubDomains: false,
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xFrameOptions: { action: "deny" },
    }),
  );
}
