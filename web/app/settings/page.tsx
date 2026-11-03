import AuthGuard from "../../components/auth/auth-guard";
import HomeShell from "../../components/marketplace/home-shell";

export default function SettingsPage() {
  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <HomeShell initialView="profile" initialProfileScreen="settings" />
    </AuthGuard>
  );
}
