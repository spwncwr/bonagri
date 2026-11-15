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

export function saveAuth(
  accessToken: string,
  rememberMe: boolean,
  userId?: string,
) {
  if (typeof window === "undefined") return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  // Any live session supersedes the two-step bridge — a stale pre-auth
  // hand-off must never linger in the tab after sign-in completes.
  clearPreAuthToken();

  const storage = rememberMe ? localStorage : sessionStorage;

  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));

  // Bind before the first guarded screen renders so the new account never
  // paints with the previous account's saved theme.
  if (userId) setThemeScope(userId);
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;

  return (
    localStorage.getItem(ACCESS_TOKEN_KEY) ??
    sessionStorage.getItem(ACCESS_TOKEN_KEY)
  );
}

export function getStoredAuth(): StoredAuth | null {
  const accessToken = getAccessToken();

  if (!accessToken) return null;

  return {
    accessToken,
    rememberMe: localStorage.getItem(REMEMBER_ME_KEY) === "true",
  };
}

export function clearAuth() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REMEMBER_ME_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  clearPreAuthToken();
  setThemeScope(null);
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

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getAccessToken();

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
