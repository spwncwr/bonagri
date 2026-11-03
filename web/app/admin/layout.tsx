"use client";

import type { ReactNode } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import AdminShell from "../../components/admin/admin-shell";
import { AdminSessionSkeleton } from "../../components/admin/admin-ui";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard requiredRole="ADMIN" fallback={<AdminSessionSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}
