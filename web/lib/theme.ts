export type ThemeMode = "light" | "dark";

export const THEME_ATTRIBUTE = "data-theme";
export const THEME_SCOPE_EVENT = "bonagri:theme-scope-change";
export const THEME_CHANGE_EVENT = "bonagri:theme-change";

const GUEST_KEY = "bonagri_theme";
const PREFS_KEY = "bonagri_theme_prefs";
const SCOPE_KEY = "bonagri_theme_scope";

const LIGHT: ThemeMode = "light";
const DARK: ThemeMode = "dark";

const THEME_COLORS: Record<ThemeMode, string> = {
  light: "#ffffff",
  dark: "#0b0b12",
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalize(value: string | null): ThemeMode | null {
  return value === DARK ? DARK : value === LIGHT ? LIGHT : null;
}

function readPrefs(): Record<string, string> {
  const store = storage();
  if (!store) return {};

  try {
    const parsed = JSON.parse(store.getItem(PREFS_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs: Record<string, string>) {
  const store = storage();
  if (!store) return;

  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage full or blocked — the in-memory theme still applies */
  }
}

/** The account whose preference is currently active, or null for guests. */
export function getThemeScope(): string | null {
  const store = storage();
  if (!store) return null;

  try {
    return store.getItem(SCOPE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Saved preference for a scope: the account's own value first, then the guest
 * value, then light. Accounts never read each other's stored preference.
 */
export function readStoredTheme(scope: string | null): ThemeMode | null {
  const store = storage();
  if (!store) return null;

  if (scope) {
    const own = normalize(readPrefs()[scope]);
    if (own) return own;
  }

  try {
    return normalize(store.getItem(GUEST_KEY));
  } catch {
    return null;
  }
}

export function writeStoredTheme(mode: ThemeMode, scope: string | null) {
  const store = storage();
  if (!store) return;

  try {
    if (scope) {
      const prefs = readPrefs();
      prefs[scope] = mode;
      writePrefs(prefs);
    } else {
      store.setItem(GUEST_KEY, mode);
    }
  } catch {
    /* ignore unavailable storage */
    return;
  }

  emit(THEME_CHANGE_EVENT);
}

/** Resolves the mode that should be on screen right now. */
export function resolveThemeMode(): ThemeMode {
  return readStoredTheme(getThemeScope()) ?? LIGHT;
}

/**
 * Binds the theme preference to an authenticated account (or releases it back
 * to the guest scope on logout). Preferences already stored for other accounts
 * are left untouched.
 */
export function setThemeScope(scope: string | null) {
  const store = storage();
  if (!store) return;

  try {
    const current = store.getItem(SCOPE_KEY) || null;
    if (current === scope) return;

    if (scope) store.setItem(SCOPE_KEY, scope);
    else store.removeItem(SCOPE_KEY);
  } catch {
    return;
  }

  applyTheme(resolveThemeMode());

  emit(THEME_SCOPE_EVENT);
}

function emit(type: string) {
  if (typeof window === "undefined") return;

  try {
    window.dispatchEvent(new CustomEvent(type));
  } catch {
    /* events are a convenience; storage stays the source of truth */
  }
}

/** Subscription surface for useSyncExternalStore: storage is the source of truth. */
export function subscribeTheme(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handler = () => onChange();
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  window.addEventListener(THEME_SCOPE_EVENT, handler);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handler);
    window.removeEventListener(THEME_SCOPE_EVENT, handler);
  };
}

export function getThemeSnapshot(): ThemeMode {
  return resolveThemeMode();
}

/** Server render always emits the light markup; the boot script corrects it pre-paint. */
export function getThemeSnapshotServer(): ThemeMode {
  return LIGHT;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, mode);
  root.style.setProperty("background-color", THEME_COLORS[mode]);

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLORS[mode];
}

/**
 * Written into the root layout so the saved theme is already on the document
 * for the first paint, and used as the single source for the browser chrome
 * colour. Mirrors readStoredTheme()/resolveThemeMode() synchronously.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var d=document,l=localStorage;function n(v){return v==="dark"?"dark":v==="light"?"light":null}var p={};try{p=JSON.parse(l.getItem("${PREFS_KEY}")||"{}")}catch(e){}var s=l.getItem("${SCOPE_KEY}");var m=(s&&n(p[s]))||n(l.getItem("${GUEST_KEY}"))||"light";d.documentElement.setAttribute("${THEME_ATTRIBUTE}",m);d.documentElement.style.setProperty("background-color",m==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}");var t=d.querySelector('meta[name="theme-color"]');if(!t){t=d.createElement("meta");t.name="theme-color";d.head.appendChild(t)}t.content=m==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}";}catch(e){}})();`;
