import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const login = read("../app/login/page.tsx");
const security = read("../app/admin/security/page.tsx");
const auth = read("../lib/auth.ts");
const shell = read("../components/admin/admin-shell.tsx");

// HP2 web contract: the admin password login must branch into the two-step
// handshake, the security console must drive enrolment/one-time codes/
// disable, and the pre-auth bridge must live in sessionStorage only.

test("an admin password login branches before any token is stored", () => {
  assert.match(login, /twoFactorSetupRequired/);
  assert.match(login, /twoFactorRequired/);
  // unenrolled admin → mandatory enrolment on the security screen, with the
  // hand-off token parked in sessionStorage (never localStorage)
  assert.match(login, /savePreAuthToken\(data\.preAuthToken\)/);
  assert.match(login, /router\.push\("\/admin\/security"\)/);
  // enrolled admin → the code step posts the pre-auth token as Bearer
  assert.match(login, /api\/auth\/2fa\/verify/);
  assert.match(login, /Authorization: `Bearer \$\{preAuthToken\}`/);
  // no session may be saved from a two-step response; the branch must key
  // off the pre-auth token because the enrolment reply omits
  // twoFactorRequired entirely (regression: the setup reply once fell
  // through to "no access token")
  assert.match(login, /"preAuthToken" in data/);
  // a stale session from a previous user must be dropped BEFORE the
  // hand-off token is parked (regression: an old buyer token made the
  // guard bounce enrolment back to the homepage)
  assert.match(
    login,
    /clearAuth\(\);\s+savePreAuthToken\(data\.preAuthToken\)/,
  );
  const branch = login.slice(
    login.indexOf('"preAuthToken" in data'),
    login.indexOf("saveAuth(data.accessToken"),
  );
  assert.ok(branch.length > 0, "two-step branch must precede saveAuth");
  assert.match(branch, /router\.push\("\/admin\/security"\)/);
});

test("the code step offers the recovery fallback and handles a dead window", () => {
  assert.match(login, /use a recovery code instead/i);
  assert.match(login, /Use authenticator app instead/);
  // a wrong code keeps the step; an expired/superseded sign-in token
  // returns the form to the password step instead of stranding the user
  assert.match(login, /sign-in token/i);
  assert.match(login, /setStep\("password"\)/);
});

test("the security console enrols with QR + code and gates the recovery codes", () => {
  assert.match(security, /QRCodeSVG/);
  assert.match(security, /api\/auth\/2fa\/setup/);
  assert.match(security, /api\/auth\/2fa\/enable/);
  // recovery codes are shown once, behind an explicit save confirmation
  assert.match(security, /recoveryCodes\.map/);
  assert.match(security, /codesSaved/);
  assert.match(security, /disabled=\{!codesSaved\}/);
  // the enrolment hand-off token is cleared the moment it is consumed
  assert.match(security, /clearPreAuthToken\(\)/);
  // one setup request per mount — a double-invoke would regenerate the
  // pending secret and desync the displayed QR from the API's stored one
  // (every code would then be rejected)
  assert.match(security, /setupRequestRef/);
  const setupCalls = security.match(/await (?:start|request)Setup\(/g) || [];
  assert.equal(
    setupCalls.filter((c) => c.startsWith("await requestSetup")).length,
    1,
    "only the post-disable re-enrol may mint a fresh secret directly",
  );
  // an enrolment response carrying a JWT is persisted via saveAuth
  assert.match(security, /saveAuth\(data\.accessToken/);
});

test("disabling 2FA re-proves password + code with a recovery toggle", () => {
  assert.match(security, /api\/auth\/2fa\/disable/);
  assert.match(security, /disablePassword/);
  assert.match(security, /disableUseRecovery/);
  assert.match(security, /Use a recovery code instead/);
  // a successful disable restarts the wizard — the mandate re-bites
  assert.match(security, /setView\("setup"\)/);
});

test("the auth lib carries2FA enrolment state and the pre-auth bridge", () => {
  assert.match(auth, /twoFactorEnabled\?: boolean/);
  assert.match(auth, /savePreAuthToken/);
  assert.match(auth, /readPreAuthToken/);
  assert.match(auth, /clearPreAuthToken/);
  // the bridge must be sessionStorage-scoped (tab lifetime, not persistent)
  assert.match(auth, /sessionStorage\.setItem\(PREAUTH_KEY/);
  // clearing the session also clears any dangling hand-off token
  const clearBlock = auth.slice(
    auth.indexOf("export function clearAuth"),
    auth.indexOf("const PREAUTH_KEY"),
  );
  assert.match(clearBlock, /clearPreAuthToken\(\)/);
});

test("the admin guard lets the enrolment hand-off past the session check", () => {
  const guard = read("../components/auth/auth-guard.tsx");
  // the hand-off reaches /admin/security with NO session — only the pre-auth
  // token; the guard must not bounce it into a login loop
  assert.match(guard, /preAuthHandoff/);
  assert.match(
    guard,
    /pathname === "\/admin\/security" && readPreAuthToken\(\)/,
  );
  // every other sessionless visitor still goes to /login, and the security
  // page bounces itself once the hand-off token is proven dead
  assert.match(guard, /router\.replace\("\/login"\)/);
  assert.match(security, /router\.replace\("\/login"\)/);
});

test("the admin nav exposes the security section", () => {
  assert.match(
    shell,
    /\{ href: "\/admin\/security", label: "Security", icon: SettingsIcon \}/,
  );
});
