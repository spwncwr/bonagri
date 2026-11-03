import Link from "next/link";
import { notFound } from "next/navigation";
import { buildImageUrl } from "../../../lib/media";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type StorefrontProduct = {
  id: string;
  name: string;
  unit: string;
  price: string;
  imageUrl: string | null;
  ratingAverage?: number | null;
  ratingCount?: number;
  category: { name: string };
  inventory: { quantity: number; reservedQuantity: number } | null;
};

type Storefront = {
  id: string;
  businessName: string;
  description: string | null;
  logoUrl: string | null;
  city: string | null;
  province: string | null;
  verified: boolean;
  createdAt: string;
  products: StorefrontProduct[];
};

async function loadStorefront(id: string): Promise<Storefront | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/suppliers/${encodeURIComponent(id)}/storefront`,
      { cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Unable to load shop");
    return (await response.json()) as Storefront;
  } catch {
    return null;
  }
}

function formatPrice(value: string) {
  return `R ${Number(value).toFixed(2)}`;
}

// Public destination for FEATURED_SHOPS promotions. It shows only the public
// storefront payload (no owner data); adding to cart still happens inside the
// guarded product screen.
export default async function ShopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shop = await loadStorefront(id);

  if (!shop) {
    notFound();
  }

  const logo = buildImageUrl(shop.logoUrl, 160);

  return (
    <main className="min-h-screen bg-[#f7f6f0] pb-16 text-[#17251b]">
      <header className="border-b border-[#dfe4dc] bg-[#e8eee3]">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
          <Link
            href="/"
            className="text-[11px] font-black uppercase tracking-[0.18em] text-[#17633a] hover:underline"
          >
            BonAgri marketplace
          </Link>

          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white bg-white shadow-sm">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={shop.businessName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-2xl font-black text-[#17633a]">
                  {shop.businessName.slice(0, 1)}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  {shop.businessName}
                </h1>
                {shop.verified ? (
                  <span className="rounded-full bg-[#dcf0e2] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#17633a]">
                    Verified
                  </span>
                ) : null}
              </div>

              {shop.city || shop.province ? (
                <p className="mt-1 text-xs font-semibold text-[#5d695f]">
                  {[shop.city, shop.province].filter(Boolean).join(", ")}
                </p>
              ) : null}

              {shop.description ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#4d5a50]">
                  {shop.description}
                </p>
              ) : null}

              <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-[#7b867d]">
                {shop.products.length}{" "}
                {shop.products.length === 1 ? "product" : "products"} on the
                market
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {shop.products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-10 text-center">
            <p className="text-sm font-black text-[#243229]">
              This shop has no active products right now
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex rounded-xl bg-[#17633a] px-5 py-2.5 text-xs font-black text-white hover:bg-[#0f4d2b]"
            >
              Browse the marketplace
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
            {shop.products.map((product) => {
              const image = buildImageUrl(product.imageUrl, 480);
              const available =
                (product.inventory?.quantity ?? 0) -
                (product.inventory?.reservedQuantity ?? 0);

              return (
                <Link
                  key={product.id}
                  href={`/products/${product.id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-[#e1e6dd] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden bg-[#eef2ea]">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image}
                        alt={product.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-black text-[#304635]/60">
                        {product.name.slice(0, 1)}
                      </div>
                    )}
                    {available <= 0 ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                        <span className="rounded-full bg-[#17251b] px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                          Out of stock
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    <div className="text-[9px] font-black uppercase tracking-wide text-[#7b867d]">
                      {product.category.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13px] font-black leading-tight text-[#243229]">
                      {product.name}
                    </div>
                    <div className="mt-auto pt-2 text-sm font-black text-[#17633a]">
                      {formatPrice(product.price)}
                      <span className="ml-1 text-[10px] font-bold text-[#7b867d]">
                        / {product.unit}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
