import { setThemeScope } from "./theme";

const ACCESS_TOKEN_KEY = "bonagri_access_token";
const REMEMBER_ME_KEY = "bonagri_remember_me";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

export type UserRole =
  | "BUYER"
  | "SUPPLIER"
  | "AGRO_DEALER"
  | "TRANSPORTER"
  | "ADMIN";

// SupplierProfile as /api/auth/me returns it — what the vendor edits on
// /supplier/settings. registrationNo and verified are display-only.
export type SupplierAccount = {
  businessName: string;
  description: string | null;
  registrationNo: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  logoUrl: string | null;
  verified: boolean;
};

// TransporterProfile as /api/auth/me returns it — what a transporter edits
// from the Profile tab.
export type TransporterAccount = {
  businessName: string;
  vehicleType: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  province: string | null;
  serviceProvinces: string[];
  verified: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  // HP2: /auth/me reports admin 2FA enrolment — /admin/security reads it to
  // choose between the enrolment wizard and the enabled status. Absent or
  // false for every other role (only ADMIN can enrol).
  twoFactorEnabled?: boolean;
  // Only a supplier/agro dealer carries the first, only a transporter the
  // second; both are null for a buyer.
  supplierProfile?: SupplierAccount | null;
  transporterProfile?: TransporterAccount | null;
};

export type StoredAuth = {
  accessToken: string;
  rememberMe: boolean;
};

// ---------- HP5: session state ----------
//
// The access token lives ONLY in this module variable — never localStorage
// or sessionStorage (exit criterion: no storage token on a fresh login).
// The durable credential is the server's HttpOnly refresh cookie
// (Path=/api/auth); memory dies with the tab and a silent refresh mints a
// new access token from the cookie.

let accessToken: string | null = null;

// The original fetch, captured before window.fetch is wrapped below — the
// refresh and logout calls themselves must never re-enter the interceptor.
let originalFetch: typeof fetch =
  typeof window === "undefined" ? fetch : window.fetch.bind(window);

export function saveAuth(
  token: string,
  rememberMe: boolean,
  userId?: string,
) {
  if (typeof window === "undefined") return;

  accessToken = token;

  // Any token a pre-HP5 build persisted is purged here and adopted into
  // memory once via getAccessToken (graceful cutover). rememberMe is a
  // non-secret preference — it also acts as the "this tab has a session"
  // hint that gates silent refresh below.
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  // Any live session supersedes the two-step bridge — a stale pre-auth
  // hand-off must never linger in the tab after sign-in completes.
  clearPreAuthToken();
  localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));

  // Bind before the first guarded screen renders so the new account never
  // paints with the previous account's saved theme.
  if (userId) setThemeScope(userId);
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;

  if (accessToken) return accessToken;

  // Graceful cutover: a token written by the previous build is adopted
  // into memory here and erased from storage immediately — storage never
  // holds a live token again.
  const legacy =
    localStorage.getItem(ACCESS_TOKEN_KEY) ??
    sessionStorage.getItem(ACCESS_TOKEN_KEY);

  if (!legacy) return null;

  accessToken = legacy;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  return legacy;
}

export function getStoredAuth(): StoredAuth | null {
  const token = getAccessToken();

  if (!token) return null;

  return {
    accessToken: token,
    rememberMe: localStorage.getItem(REMEMBER_ME_KEY) === "true",
  };
}

// True when this tab should hold a session: a live in-memory token or the
// remember-me marker written at sign-in. Gates (a) whether a 401 may spend
// a refresh call and (b) product-rail's guest short-circuit — anonymous
// visitors never generate 401 console noise.
export function hasSessionHint(): boolean {
  if (typeof window === "undefined") return false;

  return (
    accessToken !== null || localStorage.getItem(REMEMBER_ME_KEY) !== null
  );
}

export function clearAuth() {
  if (typeof window === "undefined") return;

  // Only a tab that HAD a session spends a logout call — revoking the
  // refresh row server-side is what makes logout real everywhere (HP5).
  const hadSession =
    accessToken !== null || localStorage.getItem(REMEMBER_ME_KEY) !== null;

  accessToken = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REMEMBER_ME_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  clearPreAuthToken();
  setThemeScope(null);

  if (hadSession) {
    void originalFetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
  }
}

// HP2: the password-verified pre-auth token bridges the two login steps and
// the mandatory first-admin-enrolment hand-off (login → /admin/security).
// sessionStorage keeps it in the tab that earned it; the API owns the real
// security — 5-minute TTL, single use, superseded by any newer login.
const PREAUTH_KEY = "bonagri_2fa_preauth";

export function savePreAuthToken(token: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PREAUTH_KEY, token);
}

export function readPreAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(PREAUTH_KEY);
}

export function clearPreAuthToken() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PREAUTH_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
}

// ---------- HP5: silent refresh ----------

// Single flight: concurrent 401s share ONE rotation; the queue replays
// with the winner's fresh token.
let refreshInFlight: Promise<string | null> | null = null;

async function requestRefresh(): Promise<string | null> {
  let response: Response;

  try {
    // originalFetch, not fetch: the refresh call itself must never be
    // intercepted, and the cookie rides along via credentials: include.
    response = await originalFetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Network blip — not proof the session is dead, so keep it.
    return null;
  }

  if (!response.ok) {
    // The cookie is gone (logged out elsewhere, expired, reused): this
    // session is dead — drop it so the UI falls back to guest.
    clearAuth();
    return null;
  }

  const data = (await response.json().catch(() => null)) as {
    accessToken?: string;
    user?: { id?: string };
  } | null;

  if (!data?.accessToken) return null;

  saveAuth(
    data.accessToken,
    localStorage.getItem(REMEMBER_ME_KEY) === "true",
    data.user?.id,
  );
  return data.accessToken;
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

// Resolve this tab's session: reuse the in-memory token, or (with a
// session hint) join the single-flight cookie refresh. Guests get null
// without spending a request — exactly the pre-HP5 behaviour.
export async function ensureSession(): Promise<string | null> {
  const existing = getAccessToken();
  if (existing) return existing;
  if (!hasSessionHint()) return null;

  return refreshAccessToken();
}

// Auth-flow endpoints where a 401 is a legitimate answer (wrong password,
// dead pre-auth, bad TOTP…) — replaying those with a new token would only
// duplicate the failure. Everything else under /api/ may refresh+replay.
const NO_REFRESH_PATHS = [
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/resend-verification",
  "/api/auth/verify-email",
  "/api/auth/2fa/setup",
  "/api/auth/2fa/enable",
  "/api/auth/2fa/verify",
  "/api/auth/2fa/disable",
  "/api/auth/step-up",
];

type RetriableInit = RequestInit & { __hp5Retried?: boolean };

type PatchedFetch = typeof fetch & {
  __bonagriHp5?: boolean;
  __bonagriOriginal?: typeof fetch;
};

function withBearer(
  init: RequestInit | undefined,
  input: RequestInfo | URL,
  token: string,
): RetriableInit {
  const base =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(base);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers, __hp5Retried: true };
}

function shouldAttemptRefresh(
  url: string,
  init: RequestInit | undefined,
): boolean {
  // Already replayed once — a second 401 passes through, never loops.
  if ((init as RetriableInit | undefined)?.__hp5Retried) return false;
  if (!url.includes("/api/")) return false;
  if (NO_REFRESH_PATHS.some((path) => url.includes(path))) return false;
  // Only a tab that should hold a session spends a refresh call.
  return hasSessionHint();
}

// Wrap window.fetch once: on 401 (outside the auth flow, once per request)
// rotate the HttpOnly refresh cookie and replay with the new access token.
// The116 authHeaders() call sites keep working unchanged — that is the
// whole point of doing this centrally instead of per call site.
function installSessionInterceptor() {
  if (typeof window === "undefined") return;

  const existing = window.fetch as PatchedFetch | undefined;
  if (typeof existing === "function" && existing.__bonagriHp5) {
    // HMR re-ran this module: keep wrapping the ORIGINAL fetch, never our
    // own previous patch (that would refresh twice per 401).
    originalFetch = existing.__bonagriOriginal ?? existing;
    return;
  }

  const patched: PatchedFetch = async (input, init) => {
    const response = await originalFetch(input, init);

    if (response.status !== 401) return response;

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (!shouldAttemptRefresh(url, init)) return response;

    const fresh = await refreshAccessToken();
    if (!fresh) return response;

    // Replay ONCE with the fresh access token; the retriable flag above
    // guarantees a second 401 goes straight through to the caller.
    return originalFetch(input, withBearer(init, input, fresh));
  };

  patched.__bonagriHp5 = true;
  patched.__bonagriOriginal = originalFetch;
  window.fetch = patched;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  // Hard reload: memory is empty, so restore from the cookie FIRST —
  // /auth/me then goes out with a valid bearer instead of a 401 round-trip.
  const token = await ensureSession();

  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      clearAuth();
      return null;
    }

    const user = (await response.json()) as AuthUser;
    setThemeScope(user.id);

    return user;
  } catch {
    return null;
  }
}

installSessionInterceptor();

// Hard reload: kick the cookie restore at module load so most callers
// (effects run after JS parse + hydration) already hold a token before
// their first request. Failures clear a dead session inside requestRefresh.
if (
  typeof window !== "undefined" &&
  accessToken === null &&
  localStorage.getItem(REMEMBER_ME_KEY) !== null
) {
  void ensureSession();
}
