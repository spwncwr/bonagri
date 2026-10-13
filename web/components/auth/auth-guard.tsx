"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  fetchCurrentUser,
  type AuthUser,
  type UserRole,
} from "../../lib/auth";

type AuthGuardProps = {
  children: ReactNode;
  /** Allow any of these roles (checked in addition to requiredRole). */
  allowedRoles?: UserRole[];
  /** Restrict to exactly one role. */
  requiredRole?: UserRole;
};

export default function AuthGuard({
  children,
  allowedRoles,
  requiredRole,
}: AuthGuardProps) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const currentUser = await fetchCurrentUser();

      if (cancelled) return;

      if (!currentUser) {
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
  }, [allowedRoles, requiredRole, router]);

  if (checking || !user) {
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
