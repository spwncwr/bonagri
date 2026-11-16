"use client";

import type { ReactNode } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import AdminShell from "../../components/admin/admin-shell";
import { StepUpProvider } from "../../components/admin/step-up-provider";
import { AdminSessionSkeleton } from "../../components/admin/admin-ui";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard requiredRole="ADMIN" fallback={<AdminSessionSkeleton />}>
      {/* HP3: one confirmation dialog + step-up fetch wrapper shared by every
          admin screen underneath (guards stay server-side; this only makes
          the 403 → password → retry handshake invisible). */}
      <StepUpProvider>
        <AdminShell>{children}</AdminShell>
      </StepUpProvider>
    </AuthGuard>
  );
}
