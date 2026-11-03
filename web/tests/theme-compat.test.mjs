import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../app/theme-compat.css", import.meta.url)),
  "utf8",
);

const SCOPE = ':where([data-theme="dark"], .admin-dark)';

/* Matches the generated line for a class literal, e.g. "bg-[#f7f6f0]". */
function declarationFor(literal) {
  const escaped = literal.replace(/[^A-Za-z0-9_-]/g, (char) => "\\" + char);
  const wanted = `${SCOPE} .${escaped}`;
  for (const rawLine of css.split("\n")) {
    const line = rawLine.trim();
    if (!line.endsWith("}") || !line.includes("{")) continue;
    const [selector, body] = line.split(/\s*\{\s*/);
    if (selector === wanted) return body.replace(/\}\s*$/, "").replace(/;\s*$/, "").trim();
  }
  return null;
}

test("the dark layer only ever targets dark scopes", () => {
  const offenders = css
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("}") && line.includes("{"))
    .filter((line) => !line.startsWith(SCOPE));
  assert.deepEqual(offenders, []);
});

test("near-white cream washes follow the page background, not a status tint", () => {
  for (const hex of ["f7f6f0", "f7f5ed", "fbfcf9", "f7faf5", "f0f7f1", "f2f8f1"]) {
    assert.equal(
      declarationFor(`bg-[#${hex}]`),
      "background-color: var(--theme-secondary-background)",
      `bg-[#${hex}] is a neutral cream, so dark mode must not paint a warning tint`,
    );
  }
});

test("real status tints keep their status colour", () => {
  assert.equal(
    declarationFor("bg-[#eee8c9]"),
    "background-color: var(--theme-warning-soft)",
  );
  assert.equal(
    declarationFor("bg-[#e5f1e4]"),
    "background-color: var(--theme-success-soft)",
  );
});

test("brand-green ink and borders brighten instead of disappearing", () => {
  assert.equal(declarationFor("text-[#17633a]"), "color: var(--theme-success-bright)");
  assert.equal(declarationFor("border-[#17633a]"), "border-color: var(--theme-success-border)");
});

test("solid brand and status backgrounds are left alone", () => {
  for (const literal of ["bg-[#17633a]", "bg-[#2d9d5e]", "bg-[#d8a521]"]) {
    assert.equal(declarationFor(literal), null, `${literal} must stay the brand solid`);
  }
});

test("text on a brand solid stays light-on-brand", () => {
  assert.equal(declarationFor("text-white"), null);
});
