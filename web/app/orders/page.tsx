import AuthGuard from "../../components/auth/auth-guard";
import HomeShell from "../../components/marketplace/home-shell";

export default function OrdersPage() {
  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <HomeShell initialView="orders" />
    </AuthGuard>
  );
}
