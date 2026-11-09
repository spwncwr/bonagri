"use client";

// Every desk screen renders inside this layout, so the rail, the header and
// the phone bottom bar are guaranteed to be present on each route — no screen
// can "lose" the navigation by rendering its own header again.
import { useEffect, useState, type ReactNode } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import SupplierShell from "../../components/supplier/supplier-shell";
import { AttentionProvider } from "../../components/supplier/attention-context";
import { fetchCurrentUser, type UserRole } from "../../lib/auth";

export default function SupplierLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [vendorRole, setVendorRole] = useState<UserRole | null>(null);
  // Filled by the dashboard (the only screen that loads low stock, EFT and
  // dispute data) through AttentionProvider; persists across navigation
  // because this layout stays mounted between desk routes.
  const [attention, setAttention] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((user) => {
      if (!cancelled) setVendorRole(user?.role ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthGuard allowedRoles={["SUPPLIER", "AGRO_DEALER"]}>
      <AttentionProvider report={setAttention}>
        <SupplierShell vendorRole={vendorRole} attention={attention}>
          {children}
        </SupplierShell>
      </AttentionProvider>
    </AuthGuard>
  );
}
