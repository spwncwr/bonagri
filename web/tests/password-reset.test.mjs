import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const forgot = read("../app/forgot-password/page.tsx");
const reset = read("../app/reset-password/page.tsx");
const login = read("../app/login/page.tsx");

// HP4 web contract: recovery must not become an account-enumeration oracle
// (one fixed confirmation whatever the API decided), the reset token may only
// travel from the emailed link to the API, and both screens must be reachable
// from sign-in.

test("forgot-password asks for the address and repeats the generic answer", () => {
  assert.match(forgot, /api\/auth\/forgot-password/);
  assert.match(forgot, /method: "POST"/);
  assert.match(forgot, /body: JSON\.stringify\(\{ email \}\)/);
  // the server's no-enumeration sentence is the success copy verbatim — the
  // UI never branches on "found" vs "not found"
  assert.match(
    forgot,
    /If an account exists for that email, a password reset link has been sent\./,
  );
  assert.match(forgot, /readMessage\(\s*data,/);
  // throttling (5/min) surfaces as a wait, not as a dropped request
  assert.match(forgot, /status === 429/);
  assert.match(forgot, /wait a minute/i);
});

test("the reset token lives only in the URL and the request body", () => {
  assert.match(reset, /useSearchParams\(\)/);
  assert.match(reset, /searchParams\.get\("token"\)/);
  assert.match(reset, /body: JSON\.stringify\(\{ token, password \}\)/);
  // no persistence of any kind — the single-use token dies with the tab
  assert.doesNotMatch(reset, /localStorage\./);
  assert.doesNotMatch(reset, /localStorage\[/);
  assert.doesNotMatch(reset, /sessionStorage\./);
  assert.doesNotMatch(reset, /document\.cookie/);
  // useSearchParams needs a boundary to keep the page prerenderable
  assert.match(reset, /<Suspense/);
});

test("reset-password mirrors the register rules and clears the secret", () => {
  // same floor as RegisterDto (8 chars) checked before the round-trip
  assert.match(reset, /password\.length < 8/);
  assert.match(reset, /password !== confirmPassword/);
  assert.match(reset, /Passwords do not match/);
  assert.match(reset, /minLength=\{8\}/);
  assert.match(reset, /autoComplete="new-password"/);
  // the new password leaves component state as soon as the API accepts it
  assert.match(reset, /setPassword\(""\);\s*setConfirmPassword\(""\);\s*setStatus\("done"\)/);
});

test("a dead link cannot be retried into success", () => {
  // 400 from the API = unknown/expired/used (one generic message) → the
  // form is replaced by the request-a-new-link state
  assert.match(reset, /response\.status === 400/);
  assert.match(reset, /This reset link is invalid or has expired\./);
  assert.match(reset, /href="\/forgot-password"/);
  // a missing token up front lands in the same state
  assert.match(reset, /missing its token/);
});

test("sign-in offers recovery on the password step only", () => {
  assert.match(login, /href="\/forgot-password"/);
  const linkAt = login.indexOf('href="/forgot-password"');
  // the 2FA code step comes later in the file — the link must sit before it
  const codeStepAt = login.indexOf('id="two-factor-code"');
  assert.ok(linkAt > -1 && codeStepAt > -1);
  assert.ok(linkAt < codeStepAt, "link lives in the password step");
});
