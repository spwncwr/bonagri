import AuthGuard from "../../components/auth/auth-guard";
import HomeShell from "../../components/marketplace/home-shell";

export default function CartPage() {
  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <HomeShell initialView="cart" />
    </AuthGuard>
  );
}
