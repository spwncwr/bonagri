import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const auth = read("../lib/auth.ts");
const login = read("../app/login/page.tsx");
const security = read("../app/admin/security/page.tsx");
const rail = read("../components/marketplace/product-rail.tsx");

const count = (source, pattern) => (source.match(pattern) ?? []).length;

// HP5 web contract (plan G5): the access token lives in memory only, the
// HttpOnly refresh cookie is the durable credential, 401s refresh silently
// through ONE shared rotation, and logout revokes the session server-side.

test("the access token lives in a module variable, never in storage", () => {
  assert.match(auth, /let accessToken: string \| null = null/);
  // storage is only ever CLEARED of tokens (legacy cutover + saveAuth)
  assert.equal(count(auth, /localStorage\.setItem\(ACCESS_TOKEN_KEY/g), 0);
  assert.equal(count(auth, /sessionStorage\.setItem\(ACCESS_TOKEN_KEY/g), 0);
  assert.match(auth, /localStorage\.removeItem\(ACCESS_TOKEN_KEY\)/);
});

test("saveAuth keeps its signature and only stores the remember-me flag", () => {
  assert.match(
    auth,
    /export function saveAuth\(\s*token: string,\s*rememberMe: boolean,\s*userId\?: string,/,
  );
  assert.match(
    auth,
    /localStorage\.setItem\(REMEMBER_ME_KEY, String\(rememberMe\)\)/,
  );
  // authHeaders() must stay callable exactly as before by all116 sites
  assert.match(
    auth,
    /export function authHeaders\(\): Record<string, string>/,
  );
});

test("401s refresh silently through one shared rotation", () => {
  assert.match(auth, /let refreshInFlight: Promise<string \| null>/);
  assert.match(auth, /api\/auth\/refresh/);
  assert.match(auth, /credentials: "include"/);
  // replay exactly once — a second 401 passes through, never loops
  assert.match(auth, /__hp5Retried/);
  // the auth-flow401s (wrong password, bad TOTP…) must never trigger it
  assert.match(auth, /"\/api\/auth\/login"/);
  assert.match(auth, /"\/api\/auth\/2fa\/verify"/);
  assert.match(auth, /"\/api\/auth\/step-up"/);
});

test("a dead cookie ends the session instead of retrying forever", () => {
  // requestRefresh clears the session when the server rejects the cookie
  const block = auth.slice(
    auth.indexOf("async function requestRefresh"),
    auth.indexOf("function refreshAccessToken"),
  );
  assert.match(block, /if \(!response\.ok\)/);
  assert.match(block, /clearAuth\(\)/);
});

test("logout is real: clearAuth revokes the cookie server-side", () => {
  const block = auth.slice(
    auth.indexOf("export function clearAuth"),
    auth.indexOf("const PREAUTH_KEY"),
  );
  assert.match(block, /api\/auth\/logout/);
  assert.match(block, /credentials: "include"/);
  // but a guest tab with nothing to revoke must not spend a request
  assert.match(block, /const hadSession/);
});

test("a hard reload restores from the cookie before the first request", () => {
  assert.match(auth, /export async function ensureSession/);
  // fetchCurrentUser restores first, so /auth/me never fires a doomed 401
  const me = auth.slice(
    auth.indexOf("export async function fetchCurrentUser"),
    auth.indexOf("installSessionInterceptor();"),
  );
  assert.ok(me.length > 0, "fetchCurrentUser must precede the install call");
  assert.match(me, /await ensureSession\(\)/);
  // and the module kicks the restore at load for every other caller
  assert.match(auth, /void ensureSession\(\);/);
  assert.match(rail, /await ensureSession\(\)/);
});

test("login and both sign-in steps hand the cookie its credentials", () => {
  assert.ok(
    count(login, /credentials: "include"/g) >= 2,
    "login + 2fa/verify must send credentials so Set-Cookie is stored",
  );
  assert.match(login, /rememberMe,/);
  assert.match(login, /JSON\.stringify\(\{ code, rememberMe \}\)/);
  // enrolment-as-login mints the same cookie
  assert.match(security, /credentials: "include"/);
  assert.match(security, /rememberMe: remembered/);
});
