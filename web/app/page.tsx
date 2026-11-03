import SplashScreen from "../components/brand/splash-screen";
import HomeShell from "../components/marketplace/home-shell";

// The shell renders the marketing hero for guests and the app-style home for
// signed-in buyers — see components/marketplace/home-shell.tsx. The optional
// ?cat= parameter makes category promotions shareable without the buyer-only
// /explore route.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string | string[] }>;
}) {
  const params = await searchParams;
  const category = typeof params.cat === "string" ? params.cat : "";

  return (
    <>
      <SplashScreen />
      <HomeShell initialCategory={category} />
    </>
  );
}
