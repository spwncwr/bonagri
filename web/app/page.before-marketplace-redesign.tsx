"use client";

import { useMemo, useState } from "react";

const categories = [
  { name: "Fresh Produce", count: "120+ listings", icon: "🥬" },
  { name: "Fruits", count: "48+ listings", icon: "🍊" },
  { name: "Vegetables", count: "76+ listings", icon: "🥕" },
  { name: "Chilli & Sauces", count: "24+ listings", icon: "🌶️" },
  { name: "Processed Foods", count: "31+ listings", icon: "🥫" },
  { name: "Farm Inputs", count: "Coming soon", icon: "🌱" },
];

const products = [
  {
    name: "Fresh Tomatoes",
    seller: "BonAgri Farm",
    location: "Tzaneen, Limpopo",
    price: "R18",
    unit: "per kg",
    badge: "Verified Supplier",
    emoji: "🍅",
  },
  {
    name: "Fresh Bananas",
    seller: "Limpopo Growers",
    location: "Mopani, Limpopo",
    price: "R25",
    unit: "per kg",
    badge: "Verified Supplier",
    emoji: "🍌",
  },
  {
    name: "Green Chilli",
    seller: "Mathevula Produce",
    location: "Giyani, Limpopo",
    price: "R32",
    unit: "per kg",
    badge: "Verified Supplier",
    emoji: "🌶️",
  },
  {
    name: "Fresh Okra",
    seller: "Local Growers",
    location: "Polokwane, Limpopo",
    price: "R28",
    unit: "per kg",
    badge: "New Supplier",
    emoji: "🥬",
  },
];

const stats = [
  ["01", "Discover", "Find agricultural products and suppliers."],
  ["02", "Connect", "Engage directly with verified market participants."],
  ["03", "Trade", "Manage orders and commercial transactions."],
  ["04", "Move", "Coordinate delivery from supplier to buyer."],
];

export default function Home() {
  const [search, setSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) return products;

    return products.filter((product) =>
      `${product.name} ${product.seller} ${product.location}`
        .toLowerCase()
        .includes(query),
    );
  }, [search]);

  return (
    <main className="min-h-screen bg-[#f8f7f2] text-[#17251b]">
      {/* Top announcement */}
      <div className="bg-[#163b25] px-6 py-2 text-center text-xs font-medium tracking-wide text-[#e8eadf]">
        Connecting agricultural supply with opportunity across African markets.
      </div>

      {/* Navigation */}
      <header className="border-b border-[#dfe3d9] bg-[#f8f7f2]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="#" className="group">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#17633a] text-xl font-bold text-white shadow-sm">
                B
              </div>
              <div>
                <div className="text-xl font-extrabold tracking-tight">
                  BonAgri
                </div>
                <div className="text-[9px] font-bold tracking-[0.22em] text-[#718073]">
                  AGRICULTURAL MARKETPLACE
                </div>
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-semibold lg:flex">
            <a href="#marketplace" className="text-[#17633a]">
              Marketplace
            </a>
            <a
              href="#categories"
              className="text-[#5d695f] transition hover:text-[#17633a]"
            >
              Categories
            </a>
            <a
              href="#how-it-works"
              className="text-[#5d695f] transition hover:text-[#17633a]"
            >
              How it works
            </a>
            <a
              href="#suppliers"
              className="text-[#5d695f] transition hover:text-[#17633a]"
            >
              Suppliers
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button className="hidden rounded-lg border border-[#cdd4ca] px-4 py-2.5 text-sm font-bold text-[#344238] transition hover:border-[#17633a] sm:block">
              Sign in
            </button>
            <button className="rounded-lg bg-[#17633a] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0f4d2b]">
              Join BonAgri
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#e9eee5]">
        <div className="absolute right-0 top-0 h-full w-1/2 opacity-40">
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,#9fb58f_0,transparent_2px)] [background-size:28px_28px]" />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-16 md:py-24 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#bdcbb8] bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#17633a]">
              <span className="h-2 w-2 rounded-full bg-[#17633a]" />
              Limpopo — A Home of Agriculture
            </div>

            <h1 className="max-w-4xl text-5xl font-extrabold leading-[1.02] tracking-[-0.04em] text-[#15251a] md:text-6xl lg:text-7xl">
              Where African agriculture meets the market.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-[#566258] md:text-xl">
              Discover agricultural products, connect with suppliers and build
              reliable trade relationships through one digital marketplace.
            </p>

            <div className="mt-9 max-w-3xl rounded-2xl border border-[#cdd6c9] bg-white p-2 shadow-xl shadow-[#3a4e3c]/10">
              <div className="flex flex-col gap-2 md:flex-row">
                <div className="flex flex-1 items-center px-4">
                  <span className="mr-3 text-xl">⌕</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search products, suppliers or locations..."
                    className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-[#8a948b]"
                  />
                </div>

                <button className="rounded-xl bg-[#17633a] px-7 py-3.5 text-sm font-bold text-white transition hover:bg-[#0f4d2b]">
                  Search marketplace
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-[#69766b]">
              <span>✓ Verified suppliers</span>
              <span>✓ Fresh produce</span>
              <span>✓ Regional trade</span>
            </div>
          </div>

          {/* Hero visual */}
          <div className="relative hidden lg:block">
            <div className="relative overflow-hidden rounded-[2rem] bg-[#244c2f] p-3 shadow-2xl shadow-[#173620]/20">
              <div className="relative flex min-h-[470px] flex-col justify-between overflow-hidden rounded-[1.5rem] bg-[#3c6b43] p-8 text-white">
                <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full border-[40px] border-[#719266]/40" />
                <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full border-[55px] border-[#173d25]/30" />

                <div className="relative">
                  <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#dce8d8]">
                    AGRICULTURE • TRADE • MOVEMENT
                  </div>
                  <div className="mt-4 text-4xl font-extrabold leading-tight">
                    From the farm
                    <br />
                    to the market.
                  </div>
                </div>

                <div className="relative grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/10 p-5 backdrop-blur">
                    <div className="text-3xl">🌾</div>
                    <div className="mt-3 text-sm font-bold">
                      Agricultural supply
                    </div>
                    <div className="mt-1 text-xs text-[#dce8d8]">
                      Discover products
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-5 backdrop-blur">
                    <div className="text-3xl">🤝</div>
                    <div className="mt-3 text-sm font-bold">
                      Market connections
                    </div>
                    <div className="mt-1 text-xs text-[#dce8d8]">
                      Build relationships
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Marketplace */}
      <section id="marketplace" className="mx-auto max-w-7xl px-6 py-16">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#17633a]">
              Marketplace
            </div>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
              Agricultural products
            </h2>
            <p className="mt-2 text-[#69766b]">
              Explore products from suppliers across the region.
            </p>
          </div>

          <button className="text-sm font-bold text-[#17633a]">
            View all products →
          </button>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {filteredProducts.map((product) => (
            <article
              key={product.name}
              className="group overflow-hidden rounded-2xl border border-[#dce2d9] bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#233b29]/10"
            >
              <div className="relative flex h-52 items-center justify-center bg-[#edf2e9] text-8xl">
                <span className="transition duration-300 group-hover:scale-110">
                  {product.emoji}
                </span>

                <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#17633a] shadow-sm">
                  {product.badge}
                </span>
              </div>

              <div className="p-5">
                <h3 className="font-extrabold">{product.name}</h3>
                <p className="mt-1 text-sm font-semibold text-[#566258]">
                  {product.seller}
                </p>
                <p className="mt-1 text-xs text-[#879188]">
                  📍 {product.location}
                </p>

                <div className="mt-5 flex items-end justify-between border-t border-[#edf0eb] pt-4">
                  <div>
                    <span className="text-xl font-extrabold text-[#17633a]">
                      {product.price}
                    </span>
                    <span className="ml-1 text-xs text-[#7c877e]">
                      {product.unit}
                    </span>
                  </div>

                  <button className="rounded-lg bg-[#edf3eb] px-4 py-2 text-xs font-bold text-[#17633a] transition hover:bg-[#17633a] hover:text-white">
                    View
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-[#cdd6cc] bg-white p-12 text-center text-[#69766b]">
            No products match your search.
          </div>
        )}
      </section>

      {/* Categories */}
      <section id="categories" className="border-y border-[#dfe4dc] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="max-w-2xl">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#17633a]">
              Explore the market
            </div>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">
              Shop by category
            </h2>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {categories.map((category) => (
              <button
                key={category.name}
                className="group rounded-2xl border border-[#dfe4dc] bg-[#fafbf8] p-5 text-left transition duration-300 hover:-translate-y-1 hover:border-[#8eb197] hover:bg-[#f0f5ed] hover:shadow-lg"
              >
                <div className="text-4xl">{category.icon}</div>
                <div className="mt-4 text-sm font-extrabold">
                  {category.name}
                </div>
                <div className="mt-1 text-xs text-[#7b877d]">
                  {category.count}
                </div>
                <div className="mt-4 text-xs font-bold text-[#17633a] opacity-0 transition group-hover:opacity-100">
                  Explore →
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20">
        <div className="text-center">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#17633a]">
            Simple by design
          </div>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
            Built around agricultural trade
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[#69766b]">
            BonAgri brings discovery, supplier relationships, transactions and
            movement together in one marketplace.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-4">
          {stats.map(([number, title, description]) => (
            <div
              key={number}
              className="rounded-2xl border border-[#dce2d9] bg-white p-7"
            >
              <div className="text-xs font-extrabold tracking-[0.2em] text-[#8a958c]">
                {number}
              </div>
              <div className="mt-8 text-xl font-extrabold">{title}</div>
              <p className="mt-2 text-sm leading-6 text-[#69766b]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Supplier CTA */}
      <section id="suppliers" className="px-6 pb-20">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#163b25]">
          <div className="relative px-8 py-14 md:px-14 md:py-16">
            <div className="absolute right-0 top-0 h-full w-1/2 opacity-20">
              <div className="h-full w-full bg-[linear-gradient(45deg,transparent_45%,#d9e7d4_46%,#d9e7d4_54%,transparent_55%)] [background-size:34px_34px]" />
            </div>

            <div className="relative max-w-2xl text-white">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#b8d1bc]">
                For farmers & suppliers
              </div>

              <h2 className="mt-4 text-3xl font-extrabold tracking-tight md:text-5xl">
                Take your products to a wider market.
              </h2>

              <p className="mt-5 max-w-xl leading-7 text-[#d0ddd2]">
                Create your supplier profile, showcase your products and connect
                with buyers looking for agricultural supply.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button className="rounded-xl bg-white px-6 py-3.5 text-sm font-extrabold text-[#163b25] transition hover:bg-[#edf3eb]">
                  Become a supplier
                </button>
                <button className="rounded-xl border border-[#6d9075] px-6 py-3.5 text-sm font-extrabold text-white transition hover:bg-white/10">
                  Learn how it works
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#dfe4dc] bg-[#f1f2ed]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col justify-between gap-8 md:flex-row">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#17633a] text-sm font-bold text-white">
                  B
                </div>
                <span className="font-extrabold">BonAgri</span>
              </div>
              <p className="mt-4 max-w-sm text-sm leading-6 text-[#6f796f]">
                A digital agricultural marketplace connecting producers,
                suppliers, traders and buyers.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm text-[#667067]">
              <a href="#marketplace" className="hover:text-[#17633a]">
                Marketplace
              </a>
              <a href="#categories" className="hover:text-[#17633a]">
                Categories
              </a>
              <a href="#suppliers" className="hover:text-[#17633a]">
                Suppliers
              </a>
              <a href="#how-it-works" className="hover:text-[#17633a]">
                How it works
              </a>
            </div>
          </div>

          <div className="mt-10 flex flex-col justify-between gap-3 border-t border-[#d8ddd5] pt-6 text-xs text-[#7a847b] md:flex-row">
            <span>© 2026 BonAgri. All rights reserved.</span>
            <span className="font-semibold">
              L I M P O P O — A H O M E O F A G R I C U L T U R E
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
