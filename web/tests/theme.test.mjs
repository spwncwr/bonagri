import test from "node:test";
import assert from "node:assert/strict";

import {
  getThemeScope,
  readStoredTheme,
  resolveThemeMode,
  setThemeScope,
  writeStoredTheme,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_CHANGE_EVENT,
  THEME_SCOPE_EVENT,
} from "../lib/theme.ts";

/* Minimal localStorage + DOM stubs: lib/theme only touches these three keys. */
function freshStorage() {
  const values = new Map();

  globalThis.localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };

  return values;
}

const events = [];

globalThis.window = {
  dispatchEvent: (event) => events.push(event.type),
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class {
  constructor(type, detail) {
    this.type = type;
    this.detail = detail;
  }
};

test("defaults to light when nobody has chosen a theme", () => {
  freshStorage();

  assert.equal(resolveThemeMode(), "light");
  assert.equal(readStoredTheme(null), null);
});

test("ignores the device colour scheme when no preference is stored", () => {
  freshStorage();
  globalThis.matchMedia = () => ({ matches: true });

  assert.equal(resolveThemeMode(), "light");
});

test("guest choice survives a restart", () => {
  const values = freshStorage();
  writeStoredTheme("dark", null);

  assert.equal(resolveThemeMode(), "dark");
  assert.equal(values.get("bonagri_theme"), "dark");
});

test("preferences are stored per account, never in the guest key", () => {
  const values = freshStorage();

  writeStoredTheme("dark", "user-a");

  assert.equal(JSON.parse(values.get("bonagri_theme_prefs"))["user-a"], "dark");
  assert.equal(values.get("bonagri_theme"), undefined);
});

test("accounts cannot read each other's preference", () => {
  freshStorage();
  writeStoredTheme("dark", "user-a");
  setThemeScope("user-a");

  assert.equal(resolveThemeMode(), "dark");

  setThemeScope("user-b");
  assert.equal(getThemeScope(), "user-b");
  assert.equal(resolveThemeMode(), "light");

  setThemeScope("user-a");
  assert.equal(resolveThemeMode(), "dark");
});

test("an account with no saved choice falls back to the guest choice", () => {
  freshStorage();
  writeStoredTheme("dark", null);
  setThemeScope("user-c");

  assert.equal(resolveThemeMode(), "dark");
});

test("logging out releases the account scope", () => {
  freshStorage();
  writeStoredTheme("dark", "user-a");
  setThemeScope("user-a");
  setThemeScope(null);

  assert.equal(getThemeScope(), null);
  assert.equal(resolveThemeMode(), "light");
});

test("corrupt stored values resolve to light", () => {
  const values = freshStorage();
  values.set("bonagri_theme", "neon");
  values.set("bonagri_theme_prefs", "not json");

  assert.equal(resolveThemeMode(), "light");
  assert.equal(readStoredTheme("user-a"), null);
});

test("scope changes are announced so the provider can re-render", () => {
  freshStorage();
  events.length = 0;

  setThemeScope("user-d");

  assert.deepEqual(events, [THEME_SCOPE_EVENT]);
  assert.equal(THEME_ATTRIBUTE, "data-theme");
});

test("saving a choice notifies the store subscribers", () => {
  freshStorage();
  events.length = 0;

  writeStoredTheme("dark", null);

  assert.deepEqual(events, [THEME_CHANGE_EVENT]);
});

test("the boot script mirrors the module for every stored combination", () => {
  const run = (stored) => {
    const metas = [];
    const root = {
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      style: {
        values: {},
        setProperty(name, value) {
          this.values[name] = value;
        },
      },
    };
    const dom = {
      documentElement: root,
      head: { appendChild: (node) => metas.push(node) },
      createElement: () => ({ name: "", content: "" }),
      querySelector: (selector) =>
        selector === 'meta[name="theme-color"]' ? (metas[0] ?? null) : null,
    };
    const store = { getItem: (key) => (key in stored ? stored[key] : null) };

    new Function("document", "localStorage", THEME_BOOTSTRAP_SCRIPT)(dom, store);

    return { mode: root.attrs[THEME_ATTRIBUTE], meta: metas[0]?.content };
  };

  assert.deepEqual(run({}), { mode: "light", meta: "#ffffff" });
  assert.deepEqual(run({ bonagri_theme: "dark" }), { mode: "dark", meta: "#0b0b12" });
  assert.deepEqual(run({ bonagri_theme: "light" }), { mode: "light", meta: "#ffffff" });
  assert.deepEqual(
    run({
      bonagri_theme: "dark",
      bonagri_theme_scope: "a",
      bonagri_theme_prefs: '{"a":"light"}',
    }),
    { mode: "light", meta: "#ffffff" },
  );
  assert.deepEqual(
    run({
      bonagri_theme: "dark",
      bonagri_theme_scope: "a",
      bonagri_theme_prefs: '{"b":"light"}',
    }),
    { mode: "dark", meta: "#0b0b12" },
  );
  assert.deepEqual(
    run({ bonagri_theme: "junk", bonagri_theme_prefs: "broken{" }),
    { mode: "light", meta: "#ffffff" },
  );
});
