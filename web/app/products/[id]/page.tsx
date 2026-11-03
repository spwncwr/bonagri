import HomeShell from "../../../components/marketplace/home-shell";

// The product viewing screen (CP17) is part of the app shell but the product
// payload itself is public, so this route is intentionally unguarded: a
// refresh or shared /products/:id link opens the same full-screen view a
// buyer reaches by tapping a listing image.
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <HomeShell initialProductId={id} />;
}
