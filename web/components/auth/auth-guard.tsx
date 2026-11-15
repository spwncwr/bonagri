"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchCurrentUser,
  readPreAuthToken,
  type AuthUser,
  type UserRole,
} from "../../lib/auth";

type AuthGuardProps = {
  children: ReactNode;
  /** Allow any of these roles (checked in addition to requiredRole). */
  allowedRoles?: UserRole[];
  /** Restrict to exactly one role. */
  requiredRole?: UserRole;
  /** Shown while the session is being checked (defaults to the light spinner). */
  fallback?: ReactNode;
};

export default function AuthGuard({
  children,
  allowedRoles,
  requiredRole,
  fallback,
}: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  // HP2: the mandatory first-admin-enrolment hand-off arrives with NO
  // session — only the pre-auth token in sessionStorage. Without this mode
  // the guard would bounce it straight back to /login (infinite loop); the
  // security page validates the token server-side and redirects itself the
  // moment it is dead.
  const [preAuthHandoff, setPreAuthHandoff] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const currentUser = await fetchCurrentUser();

      if (cancelled) return;

      if (!currentUser) {
        if (pathname === "/admin/security" && readPreAuthToken()) {
          setPreAuthHandoff(true);
          setChecking(false);
          return;
        }
        router.replace("/login");
        return;
      }

      const roleAllowed =
        (!requiredRole || currentUser.role === requiredRole) &&
        (!allowedRoles || allowedRoles.includes(currentUser.role));

      if (!roleAllowed) {
        router.replace("/");
        return;
      }

      setUser(currentUser);
      setChecking(false);
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [allowedRoles, pathname, requiredRole, router]);

  if (checking || (!user && !preAuthHandoff)) {
    if (fallback) return <>{fallback}</>;

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-700" />
          <p className="mt-4 text-sm text-slate-600">
            Checking your BonAgri session...
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
