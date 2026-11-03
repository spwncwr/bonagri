import AuthGuard from "../../components/auth/auth-guard";
import HomeShell from "../../components/marketplace/home-shell";

// Explore is part of the buyer app shell (Home / Explore / Cart / Profile),
// so it shares the guard the cart and profile routes use. Guests browse the
// public catalog on "/".
export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string | string[] }>;
}) {
  const params = await searchParams;
  const category = typeof params.cat === "string" ? params.cat : "";

  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <HomeShell initialView="explore" initialCategory={category} />
    </AuthGuard>
  );
}
