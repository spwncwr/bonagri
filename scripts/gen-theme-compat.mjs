#!/usr/bin/env node
/*
 * Regenerates web/app/theme-compat.css — the compatibility layer that lets the
 * existing light-mode markup (Tailwind palette classes plus hundreds of one-off
 * arbitrary hex utilities) follow the centralised dark theme without rewriting
 * screens.
 *
 * Every rule is scoped to :where([data-theme="dark"], .admin-dark) so light
 * mode keeps its current appearance and the admin area stays on the dark
 * palette it was built with. Brand greens, status solids, translucent overlays
 * and light-on-brand text are deliberately left alone.
 *
 * screens. Class strings are collected from web/app, web/components and
 * web/lib, including .ts data files whose fields carry utilities (the product
 * "tone" panels in lib/catalog.ts).
 *
 * Usage: node scripts/gen-theme-compat.mjs
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC_DIRS = [
  join(ROOT, "web", "app"),
  join(ROOT, "web", "components"),
  join(ROOT, "web", "lib"),
];
const OUT_FILE = join(ROOT, "web", "app", "theme-compat.css");

const COLOR_PROPS = [
  "bg",
  "text",
  "border",
  "from",
  "via",
  "to",
  "ring",
  "divide",
  "placeholder",
  "outline",
  "fill",
  "stroke",
  "accent",
];

const NEUTRALS = ["slate", "gray", "grey", "zinc", "neutral", "stone"];
const GREENS = ["emerald", "green", "teal", "lime"];
const REDS = ["red", "rose", "pink"];
const AMBERS = ["amber", "yellow", "orange"];
const BLUES = ["blue", "sky", "indigo", "violet", "purple", "fuchsia", "cyan"];

const SURFACE_PROPS = new Set(["bg", "from", "via", "to"]);
const LINE_PROPS = new Set(["border", "ring", "divide", "outline"]);

const PSEUDO_VARIANTS = {
  hover: ":hover",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  "focus-within": ":focus-within",
  active: ":active",
  disabled: ":disabled",
  checked: ":checked",
  placeholder: "::placeholder",
};
const GROUP_VARIANTS = { "group-hover": ".group:hover", "peer-hover": ".peer:hover" };
const MEDIA_VARIANTS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
const UNSUPPORTED_PREFIX = /^[a-z][a-z0-9-]*:/;

const FAMILIES = [...NEUTRALS, ...GREENS, ...REDS, ...AMBERS, ...BLUES];

const TOKEN_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_:./[-])((?:[a-z][a-z0-9-]*:)*)(${COLOR_PROPS.join(
    "|",
  )})-((?:\[[^\]]*\])|white|black|transparent|current|(?:${FAMILIES.join(
    "|",
  )})-\d{2,3})(?:\/([0-9]{1,3}))?`,
  "g",
);

/* ---------- colour maths ---------- */

function parseHex(raw) {
  let hex = raw.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function parseRgb(raw) {
  const m = raw.match(
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/,
  );
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function saturation({ r, g, b }) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function chroma({ r, g, b }) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function hue({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueGroup(color) {
  const h = hue(color);
  if (h >= 60 && h < 200) return "green";
  if (h >= 200 && h < 265) return "blue";
  if (h >= 265 && h < 335) return "violet";
  if (h >= 335 || h < 20) return "red";
  return "amber";
}

function nameGroup(family) {
  if (NEUTRALS.includes(family)) return "neutral";
  if (GREENS.includes(family)) return "green";
  if (REDS.includes(family)) return "red";
  if (AMBERS.includes(family)) return "amber";
  return "blue";
}

/* ---------- dark theme targets ---------- */

/*
 * BonAgri's light palette is warm cream, so a near-white amber hue (#f7f6f0,
 * #f7f5ed) is a neutral surface rather than a warning tint. HSL saturation
 * alone cannot tell them apart because it explodes close to white, so a chroma
 * floor guards the saturation test.
 */
const MIN_TINT_CHROMA = {
  green: 0.04,
  amber: 0.1,
  red: 0.06,
  blue: 0.06,
  violet: 0.06,
};

function tintGroup(color) {
  if (saturation(color) < 0.3) return null;
  const group = hueGroup(color);
  if (chroma(color) < (MIN_TINT_CHROMA[group] ?? 0.1)) return null;
  return group;
}

const SURFACE = {
  neutral: {
    card: "var(--theme-surface)",
    wash: "var(--theme-secondary-background)",
    chip: "var(--theme-elevated-surface)",
    sunk: "var(--theme-input-background)",
  },
  green: "var(--theme-success-soft)",
  amber: "var(--theme-warning-soft)",
  red: "var(--theme-error-soft)",
  blue: "var(--theme-info-soft)",
  violet: "var(--theme-info-soft)",
};

const INK_RAMP = [
  "var(--theme-primary-text)",
  "var(--theme-secondary-text)",
  "var(--theme-tertiary-text)",
  "var(--theme-muted-text)",
  "var(--theme-faint-text)",
];

const INK = {
  neutral: INK_RAMP,
  green: "var(--theme-success-bright)",
  amber: "var(--theme-warning-bright)",
  red: "var(--theme-error-bright)",
  blue: "var(--theme-info-bright)",
  violet: "var(--theme-info-bright)",
};

const LINE = {
  neutral: { subtle: "var(--theme-border)", strong: "var(--theme-border-strong)" },
  green: "var(--theme-success-border)",
  amber: "var(--theme-warning-border)",
  red: "var(--theme-error-border)",
  blue: "var(--theme-info-border)",
  violet: "var(--theme-info-border)",
};

function surfaceFor(color) {
  const l = luminance(color);
  const s = saturation(color);
  if (l < 0.3) return null; // already a dark panel
  if (l < 0.6 && s >= 0.3) return null; // brand or status solid
  const group = tintGroup(color);
  if (group) return SURFACE[group] ?? null;
  if (l >= 0.97) return SURFACE.neutral.card;
  if (l >= 0.88) return SURFACE.neutral.wash;
  if (l >= 0.78) return SURFACE.neutral.chip;
  return SURFACE.neutral.sunk;
}

function inkFor(color) {
  const l = luminance(color);
  if (l >= 0.88) return null; // light ink already reads on dark
  const group = tintGroup(color);
  if (group) return INK[group] ?? null;
  if (l < 0.28) return INK_RAMP[0];
  if (l < 0.42) return INK_RAMP[1];
  if (l < 0.55) return INK_RAMP[2];
  if (l < 0.72) return INK_RAMP[3];
  return INK_RAMP[4];
}

function lineFor(color) {
  const group = tintGroup(color);
  if (group) return LINE[group] ?? null;
  return luminance(color) >= 0.82 ? LINE.neutral.subtle : LINE.neutral.strong;
}

function paletteTarget(family, prop, scale) {
  const group = nameGroup(family);

  if (SURFACE_PROPS.has(prop)) {
    if (group === "neutral") {
      if (scale <= 50) return SURFACE.neutral.wash;
      if (scale <= 100) return SURFACE.neutral.chip;
      if (scale <= 300) return SURFACE.neutral.sunk;
      return null;
    }
    return scale <= 300 ? (SURFACE[group] ?? null) : null;
  }

  if (LINE_PROPS.has(prop)) {
    if (group === "neutral") {
      if (scale <= 200) return LINE.neutral.subtle;
      if (scale <= 500) return LINE.neutral.strong;
      return null;
    }
    return scale <= 600 ? (LINE[group] ?? null) : null;
  }

  if (group === "neutral") {
    if (scale >= 800) return INK_RAMP[0];
    if (scale === 700) return INK_RAMP[1];
    if (scale === 600) return INK_RAMP[2];
    if (scale === 500) return INK_RAMP[3];
    if (scale === 400) return INK_RAMP[4];
    return null;
  }
  return scale >= 400 ? (INK[group] ?? null) : null;
}

function arbitraryTarget(raw, prop) {
  const value = raw.slice(1, -1).replace(/_/g, " ");
  if (/^var\(/.test(value)) return null;

  if (/(linear|conic|radial)-gradient\(/.test(value)) {
    let mapped = 0;
    const translated = value.replace(/#[0-9a-fA-F]{3,8}/g, (hex) => {
      const color = parseHex(hex);
      const next = color ? surfaceFor(color) : null;
      if (!next) return hex;
      mapped += 1;
      return next;
    });
    return mapped > 0 ? translated : null;
  }

  const color = value.startsWith("#") ? parseHex(value) : parseRgb(value);
  if (!color || color.a < 0.25) return null;

  if (prop === "placeholder") return "var(--theme-disabled-text)";
  if (LINE_PROPS.has(prop)) return lineFor(color);
  if (SURFACE_PROPS.has(prop)) return surfaceFor(color);
  return inkFor(color);
}

function resolve(token) {
  const { prop, value, alpha } = token;
  if (value === "transparent" || value === "current") return null;

  if (value.startsWith("[")) {
    const inner = value.slice(1, -1);
    // bg-white/10 style light overlays are already used on dark surfaces.
    if (alpha !== undefined && /^(#)?fff|white/i.test(inner) && !/#[0-9a-f]/i.test(inner)) {
      return null;
    }
    return arbitraryTarget(value, prop);
  }

  if (value === "white") {
    if (alpha !== undefined) {
      // bg-white/95 style translucent surfaces are real chrome in light mode;
      // bg-white/5 style tints are already light overlays used on dark surfaces.
      if (SURFACE_PROPS.has(prop) && Number(alpha) >= 50) {
        return `color-mix(in srgb, ${SURFACE.neutral.card} ${alpha}%, transparent)`;
      }
      return null;
    }
    if (SURFACE_PROPS.has(prop)) return SURFACE.neutral.card;
    if (LINE_PROPS.has(prop)) return LINE.neutral.subtle;
    return null; // text-white stays white
  }

  if (value === "black") {
    if (alpha !== undefined) return null;
    if (SURFACE_PROPS.has(prop)) return SURFACE.neutral.sunk;
    if (LINE_PROPS.has(prop)) return LINE.neutral.strong;
    return "var(--theme-primary-text)";
  }

  const [family, number] = value.split("-");
  const scale = Number(number);
  if (Number.isNaN(scale)) return null;
  if (prop === "placeholder") return "var(--theme-disabled-text)";
  return paletteTarget(family, prop, scale);
}

/* ---------- scanning ---------- */

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue;
      out.push(...collectFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

function cssEscape(value) {
  let out = "";
  for (const char of value) out += /[A-Za-z0-9_-]/.test(char) ? char : "\\" + char;
  return out;
}

function parseVariants(prefix) {
  const labels = (prefix ?? "").split(":").filter(Boolean);
  const media = [];
  const pseudo = [];
  const parent = [];

  for (const label of labels) {
    if (MEDIA_VARIANTS[label] !== undefined) media.push(label);
    else if (PSEUDO_VARIANTS[label]) pseudo.push(PSEUDO_VARIANTS[label]);
    else if (GROUP_VARIANTS[label]) parent.push(GROUP_VARIANTS[label]);
    else return null;
  }
  return { media, pseudo, parent };
}

function propertyFor(prop, target) {
  if (prop === "ring") return "--tw-ring-color";
  if (prop === "from") return "--tw-gradient-from";
  if (prop === "to") return "--tw-gradient-to";
  if (prop === "via") return "--tw-gradient-via";
  if (prop === "fill") return "fill";
  if (prop === "stroke") return "stroke";
  if (prop === "accent") return "accent-color";
  if (prop === "outline") return "outline-color";
  if (prop === "placeholder") return "color";
  if (SURFACE_PROPS.has(prop)) {
    return /gradient\(/.test(target) ? "background-image" : "background-color";
  }
  if (LINE_PROPS.has(prop)) return "border-color";
  return "color";
}

const tokens = new Map();
for (const dir of SRC_DIRS) {
  for (const file of collectFiles(dir)) {
    for (const match of readFileSync(file, "utf8").matchAll(TOKEN_RE)) {
      const [, prefix, prop, value, alpha] = match;
      const key = `${prefix}${prop}-${value}${alpha !== undefined ? "/" + alpha : ""}`;
      if (!tokens.has(key)) tokens.set(key, { prefix, prop, value, alpha });
    }
  }
}

const rules = [];
const ignored = new Set();

for (const token of tokens.values()) {
  const parsed = parseVariants(token.prefix);
  if (token.prefix && parsed === null) {
    ignored.add(token.prefix.replace(/:$/, ""));
    continue;
  }
  const { media, pseudo, parent } = parsed ?? { media: [], pseudo: [], parent: [] };

  let target = resolve(token);
  if (!target) continue;

  // Placeholders and disabled labels collapse to one muted ink token.
  const mutedState = /(^|:)(placeholder|disabled):/.test(token.prefix ?? "");
  if (mutedState && !SURFACE_PROPS.has(token.prop) && !LINE_PROPS.has(token.prop)) {
    target = "var(--theme-disabled-text)";
  }

  const literal = `${token.prop}-${token.value}${token.alpha !== undefined ? "/" + token.alpha : ""}`;
  const selector = `${parent.map((p) => `${p} `).join("")}.${(token.prefix ?? "").replace(/:/g, "\\:")}${cssEscape(literal)}${pseudo.join("")}`;

  if (token.prop === "divide") {
    rules.push({
      media,
      text: `:where([data-theme="dark"], .admin-dark) .${(token.prefix ?? "").replace(/:/g, "\\:")}${cssEscape("divide-" + token.value)} > :not(:last-child) { border-color: ${target}; }`,
    });
    continue;
  }

  const property = propertyFor(token.prop, target);
  rules.push({
    media,
    text: `:where([data-theme="dark"], .admin-dark) ${selector} { ${property}: ${target}; }`,
  });
}

rules.sort((a, b) => {
  const aw = a.media.map((m) => MEDIA_VARIANTS[m]).join(",");
  const bw = b.media.map((m) => MEDIA_VARIANTS[m]).join(",");
  if (aw !== bw) return aw < bw ? -1 : 1;
  return a.text < b.text ? -1 : 1;
});

const base = rules.filter((r) => r.media.length === 0).map((r) => r.text);
const byMedia = new Map();
for (const rule of rules.filter((r) => r.media.length > 0)) {
  const width = Math.max(...rule.media.map((m) => MEDIA_VARIANTS[m]));
  if (!byMedia.has(width)) byMedia.set(width, []);
  byMedia.get(width).push(rule.text);
}

let css = `/*
 * GENERATED by scripts/gen-theme-compat.mjs — do not edit by hand.
 *
 * Dark-theme compatibility layer. It maps the light-mode colour utilities
 * already used across web/app and web/components onto the shared theme tokens
 * declared in globals.css, so existing screens follow the theme without being
 * rewritten. Rules apply only inside [data-theme="dark"] (app-wide dark mode)
 * or .admin-dark (the admin area, which always uses the dark palette).
 *
 * Brand greens, status solids, translucent light overlays and light-on-brand
 * text are intentionally left untouched.
 */

${base.join("\n")}
`;

for (const [width, list] of [...byMedia.entries()].sort((a, b) => a[0] - b[0])) {
  css += `\n@media (min-width: ${width}px) {\n${list.map((r) => "  " + r).join("\n")}\n}\n`;
}

writeFileSync(OUT_FILE, css);

console.log(
  `${relative(ROOT, OUT_FILE)}: ${base.length + [...byMedia.values()].flat().length} rules from ${tokens.size} tokens`,
);
if (ignored.size) console.log(`ignored variants: ${[...ignored].sort().join(", ")}`);
