// HP5: the refresh credential travels ONLY as an HttpOnly cookie scoped to
// /api/auth — JavaScript can never read it, and no route outside /api/auth
// ever receives it. SameSite=Lax keeps it off cross-site POSTs (CSRF),
// Secure satisfies production (browsers treat http://localhost as a
// trustworthy origin, so the dev journey still works), and Max-Age mirrors
// the server-side row TTL: a remembered session persists for 30 days, an
// unremembered one is a browser-session cookie (no Max-Age).
export const REFRESH_COOKIE_NAME = "refresh_token";

const BASE_ATTRIBUTES = ["HttpOnly", "SameSite=Lax", "Secure", "Path=/api/auth"];

export function buildRefreshCookie(
  rawToken: string,
  maxAgeSeconds?: number,
): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${rawToken}`,
    ...BASE_ATTRIBUTES,
    ...(maxAgeSeconds === undefined ? [] : [`Max-Age=${maxAgeSeconds}`]),
  ];
  return parts.join("; ");
}

// Max-Age=0 makes every browser drop the cookie immediately (same
// attributes, so it matches and overwrites the live one).
export function clearRefreshCookie(): string {
  return [`${REFRESH_COOKIE_NAME}=`, ...BASE_ATTRIBUTES, "Max-Age=0"].join(
    "; ",
  );
}

export function readRefreshCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return value || undefined;
  }

  return undefined;
}
