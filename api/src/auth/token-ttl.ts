// HP5: access tokens are short-lived — 15 minutes by default (was 24h).
// The env override exists for the transition window and the TTL=5s browser
// journey; it must be a positive number of SECONDS. jsonwebtoken treats a
// bare numeric string as milliseconds, so we always hand it a number.
export function accessTtlSeconds(): number {
  const raw = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 900;
}
