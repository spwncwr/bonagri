import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const provider = read("../components/admin/step-up-provider.tsx");
const layout = read("../app/admin/layout.tsx");
const shell = read("../components/admin/admin-shell.tsx");
const audit = read("../app/admin/audit/page.tsx");

const count = (source, pattern) => (source.match(pattern) ?? []).length;

// HP3 web contract: guarded admin mutations must replay through the step-up
// confirmation (403 STEP_UP_REQUIRED → password → X-Step-Up retry), the
// dialog lives in the admin layout, and the audit trail is browsable.

test("the provider turns STEP_UP_REQUIRED into one password-confirmed retry", () => {
  // machine-readable rejection is what triggers the handshake
  assert.match(provider, /status !== 403/);
  assert.match(provider, /code === "STEP_UP_REQUIRED"/);
  // the password re-proof mints a token from the real endpoint
  assert.match(provider, /api\/auth\/step-up/);
  assert.match(provider, /method: "POST"/);
  // and the replay carries the step-up header exactly once
  assert.match(provider, /headers\.set\("X-Step-Up", token\)/);
  assert.match(provider, /return fetch\(input, withStepUpHeader/);
  // a cancelled dialog must hand back the ORIGINAL 403 so the caller's
  // normal error path reports it (no hang, no silent success)
  assert.match(provider, /if \(password === null\) \{[\s\S]{0,160}?return response;/);
});

test("the step-up token never persists beyond memory", () => {
  // kept in a ref — dies with the tab (the comment may name the storage
  // APIs; any real ACCESS to them must fail this test)
  assert.match(provider, /const cachedToken = useRef</);
  assert.doesNotMatch(provider, /localStorage\./);
  assert.doesNotMatch(provider, /localStorage\[/);
  assert.doesNotMatch(provider, /sessionStorage\./);
  assert.doesNotMatch(provider, /sessionStorage\[/);
  assert.doesNotMatch(provider, /document\.cookie/);
  // stop trusting it before the server-side 5-minute expiry
  assert.match(provider, /expiresIn - 30/);
});

test("wrong passwords and throttle stay inside the dialog", () => {
  assert.match(provider, /mint\.status === 429/);
  assert.match(provider, /mint\.status === 401/);
  assert.match(provider, /That password is not correct/);
  // a failed attempt re-prompts instead of closing the dialog — but the
  // re-prompt must NOT be awaited here: the loop top awaits the same waiter.
  // Awaiting it would swallow the password submitted next (the discarded
  // await consumes it) and then wait for yet another entry, wedging the
  // dialog forever. Regression caught by the HP3 browser journey.
  assert.match(provider, /(?<!await )requestPassword\(message\);/);
  assert.doesNotMatch(provider, /await requestPassword\(message\)/);
  // the loop top is where the (single) awaited prompt lives
  assert.match(provider, /const password = await requestPassword\(""\)/);
});

test("the provider wraps every admin screen from the layout", () => {
  assert.match(layout, /<StepUpProvider>/);
  assert.match(layout, /<AdminShell>\{children\}<\/AdminShell>/);
  // the provider must be INSIDE the guard but ABOVE the shell so pages can
  // consume the context
  const guardAt = layout.indexOf("<AuthGuard");
  const providerAt = layout.indexOf("<StepUpProvider>");
  const shellAt = layout.indexOf("<AdminShell>");
  assert.ok(guardAt < providerAt && providerAt < shellAt);
});

test("every guarded admin page routes mutations through stepUpFetch", () => {
  // Exact counts: a dropped or double-wrapped call site fails here.
  const expected = {
    "../app/admin/users/page.tsx": 4, // status, promote-supplier, promote-transporter, transporter verify
    "../app/admin/suppliers/page.tsx": 1,
    "../app/admin/transporters/page.tsx": 1,
    "../app/admin/categories/page.tsx": 2, // create, update
    "../app/admin/banners/page.tsx": 3, // create, update, delete
    "../app/admin/notifications/page.tsx": 1, // broadcast
    "../app/admin/promotions/page.tsx": 3, // save, lifecycle, delete
  };

  for (const [path, mutations] of Object.entries(expected)) {
    const source = read(path);
    assert.match(source, /import \{ useStepUp \}/, `${path} must import the hook`);
    assert.equal(
      count(source, /await stepUpFetch\(/g),
      mutations,
      `${path} must wrap exactly ${mutations} mutation(s)`,
    );
    // reads pass straight through — only mutations pay for confirmation
    assert.ok(count(source, /await fetch\(/g) > 0, `${path} keeps plain reads`);
  }
});

test("excluded screens never enter the step-up flow", () => {
  // 2FA/verification/dispute routes are intentionally outside the 17 guarded
  // endpoints — wrapping them would break the pre-auth handshake.
  for (const path of [
    "../app/admin/security/page.tsx",
    "../app/admin/verification/page.tsx",
    "../app/admin/disputes/page.tsx",
    "../app/admin/applications/page.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /stepUpFetch/, `${path} must stay unwrapped`);
  }
});

test("the audit trail is one nav entry away", () => {
  assert.match(shell, /href: "\/admin\/audit", label: "Audit"/);
  assert.match(shell, /HistoryIcon/);
});

test("the audit page reads the feed and filters by the API's action list", () => {
  assert.match(audit, /api\/admin\/audit/);
  assert.match(audit, /authHeaders\(\)/);
  // the dropdown is driven by the response's distinct actions — no
  // duplicated list in the web
  assert.match(audit, /feed\.actions\.map\(/);
  assert.match(audit, /params\.set\("action", action\)/);
  assert.match(audit, /params\.set\("actor", actor\.trim\(\)\)/);
  // newest-first rows carry actor, target and time
  assert.match(audit, /entry\.actor/);
  assert.match(audit, /entry\.targetId/);
  assert.match(audit, /new Date\(entry\.createdAt\)\.toLocaleString\("en-ZA"/);
});
