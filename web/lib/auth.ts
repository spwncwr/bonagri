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

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
};

export type StoredAuth = {
  accessToken: string;
  rememberMe: boolean;
};

export function saveAuth(accessToken: string, rememberMe: boolean) {
  if (typeof window === "undefined") return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);

  const storage = rememberMe ? localStorage : sessionStorage;

  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));
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

    return (await response.json()) as AuthUser;
  } catch {
    return null;
  }
}
