import AuthGuard from "../../components/auth/auth-guard";
import HomeShell from "../../components/marketplace/home-shell";

export default function ProfilePage() {
  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <HomeShell initialView="profile" />
    </AuthGuard>
  );
}
