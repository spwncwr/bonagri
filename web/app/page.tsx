"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http" + "://" + "localhost" + ":" + "3000";

type ApiProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  unit: string;
  status: string;
  category: {
    name: string;
    slug: string;
  };
  supplier: {
    businessName: string;
    city: string | null;
    province: string | null;
    verified: boolean;
  };
  inventory: {
    quantity: number;
    reservedQuantity: number;
  } | null;
};

type Product = {
  id: string;
  name: string;
  category: string;
  quantity: string;
  availableQuantity: number;
  location: string;
  price: string;
  unit: string;
  supplier: string;
  verified: boolean;
  tone: string;
  visual: string;
};

const categories = [
  ["Fresh Produce", "Produce available from regional suppliers."],
  ["Fruits", "Fresh fruit from agricultural producers."],
  ["Vegetables", "Source vegetables by quantity and location."],
  ["Chilli & Sauces", "Fresh and processed chilli products."],
  ["Processed Foods", "Value-added agricultural products."],
  ["Farm Inputs", "Inputs and supplies for agricultural production."],
];

const workflow = [
  ["01", "Discover", "Search available agricultural products and suppliers."],
  ["02", "Connect", "Engage with suppliers and submit requirements."],
  ["03", "Trade", "Confirm quantities, prices and orders."],
  ["04", "Move", "Coordinate delivery from supplier to buyer."],
];

const productVisuals: Record<string, { tone: string; visual: string }> = {
  "fresh-tomatoes": { tone: "bg-[#dfe9d8]", visual: "TOMATO" },
  "fresh-bananas": { tone: "bg-[#eee8c9]", visual: "BANANA" },
  "green-chilli": { tone: "bg-[#dce9d7]", visual: "CHILLI" },
  "fresh-okra": { tone: "bg-[#e5ead8]", visual: "OKRA" },
};

function formatQuantity(quantity: number, unit: string) {
  return `${quantity.toLocaleString()} ${unit} available`;
}

function mapApiProduct(product: ApiProduct): Product {
  const visual = productVisuals[product.slug] ?? {
    tone: "bg-[#e5ead8]",
    visual: "PRODUCT",
  };

  const location = [product.supplier.city, product.supplier.province]
    .filter(Boolean)
    .join(", ");

  const availableQuantity = Math.max(
    0,
    (product.inventory?.quantity ?? 0) -
      (product.inventory?.reservedQuantity ?? 0),
  );

  return {
    id: product.id,
    name: product.name,
    category: product.category.name,
    quantity: formatQuantity(availableQuantity, product.unit),
    availableQuantity,
    location,
    price: `R${product.price}`,
    unit: `/ ${product.unit}`,
    supplier: product.supplier.businessName,
    verified: product.supplier.verified,
    tone: visual.tone,
    visual: visual.visual,
  };
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderQuantity, setOrderQuantity] = useState(1);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState<{
    orderNumber: string;
    productName: string;
    quantity: number;
    total: string;
    location: string;
    status: string;
  } | null>(null);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      orderNumber: string;
      status: string;
      total: string;
      createdAt: string;
      items: Array<{
        productName: string;
        quantity: number;
        unitPrice: string;
        lineTotal: string;
      }>;
      deliveryAddress: {
        city: string;
        province: string;
        country: string;
      };
    }>
  >([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");

  async function handleStartOrder() {
    if (!selectedProduct || ordering) return;

    setOrdering(true);
    setOrderError("");
    setOrderSuccess(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "a09e036b-0120-444c-bce4-4061d8a3f0f8",
          deliveryAddressId: "ca8a2b58-610e-4edb-bfb8-39628c6220e1",
          productId: selectedProduct.id,
          quantity: orderQuantity,
          notes: "Development order",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to place order",
        );
      }

      setOrderSuccess({
        orderNumber: data.orderNumber,
        productName: selectedProduct.name,
        quantity: orderQuantity,
        total: String(data.total),
        location: data.deliveryAddress?.city
          ? `${data.deliveryAddress.city}, ${data.deliveryAddress.province}`
          : selectedProduct.location,
        status: data.status,
      });

      await loadOrders();
      setSelectedProduct(null);
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : "Unable to place order. Please try again.",
      );
    } finally {
      setOrdering(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();

        if (search.trim()) {
          params.set("search", search.trim());
        }

        if (activeCategory !== "All") {
          const category = categories.find(
            ([name]) => name === activeCategory,
          );

          if (category) {
            params.set(
              "category",
              category[0]
                .toLowerCase()
                .replace(/ & /g, "-")
                .replace(/ /g, "-"),
            );
          }
        }

        const query = params.toString();
        const response = await fetch(
          `${API_BASE_URL}/api/products${query ? `?${query}` : ""}`,
        );

        if (!response.ok) {
          throw new Error(`Products request failed: ${response.status}`);
        }

        const data: ApiProduct[] = await response.json();

        if (!cancelled) {
          setProducts(data.map(mapApiProduct));
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load products.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, [search, activeCategory]);

  const loadOrders = useCallback(async () => {
    try {
      setOrdersLoading(true);
      setOrdersError("");

      const response = await fetch(
        `${API_BASE_URL}/api/orders?userId=a09e036b-0120-444c-bce4-4061d8a3f0f8`,
      );

      if (!response.ok) {
        throw new Error(`Orders request failed: ${response.status}`);
      }

      const data = await response.json();

      setOrders(data);
    } catch (requestError) {
      setOrdersError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load orders.",
      );
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !query ||
        `${product.name} ${product.category} ${product.location} ${product.supplier}`
          .toLowerCase()
          .includes(query);

      const matchesCategory =
        activeCategory === "All" || product.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, activeCategory]);

  return (
    <main className="min-h-screen bg-[#f7f6f0] text-[#17251b]">
      {/* Utility bar */}
      <div className="bg-[#123722] px-6 py-2 text-center text-[11px] font-semibold tracking-wide text-[#dce7db]">
        AGRICULTURAL TRADE • LIMPOPO • SOUTH AFRICA
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-20 border-b border-[#dfe3d9] bg-[#f7f6f0]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="#" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#17633a] text-lg font-black text-white">
              B
            </div>
            <div>
              <div className="text-xl font-black tracking-tight">BonAgri</div>
              <div className="text-[8px] font-bold tracking-[0.25em] text-[#778178]">
                AGRICULTURAL MARKETPLACE
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-bold lg:flex">
            <a href="#marketplace" className="text-[#17633a]">
              Marketplace
            </a>
            <a href="#requests" className="text-[#5d695f] hover:text-[#17633a]">
              Product Requests
            </a>
            <a href="#suppliers" className="text-[#5d695f] hover:text-[#17633a]">
              Suppliers
            </a>
            <a href="#orders" className="text-[#5d695f] hover:text-[#17633a]">
              My Orders
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button className="hidden rounded-lg border border-[#ccd5ca] px-4 py-2.5 text-sm font-bold sm:block">
              Sign in
            </button>
            <button className="rounded-lg bg-[#17633a] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0f4d2b]">
              Join BonAgri
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-[#dfe4dc] bg-[#e8eee3]">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:py-20 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
          <div>
            <div className="mb-6 flex items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-[#17633a]">
              <span className="h-px w-8 bg-[#17633a]" />
              Limpopo — A Home of Agriculture
            </div>

            <h1 className="max-w-4xl text-5xl font-black leading-[1.02] tracking-[-0.045em] md:text-6xl lg:text-7xl">
              Agricultural trade,
              <span className="block text-[#17633a]">connected.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5b675e] md:text-xl">
              Source agricultural products, connect with suppliers and move
              goods through a marketplace designed around real trade.
            </p>

            {/* Search */}
            <div className="mt-9 rounded-2xl border border-[#cdd6ca] bg-white p-2 shadow-xl shadow-[#203b29]/10">
              <div className="flex flex-col gap-2 md:flex-row">
                <div className="flex flex-1 items-center px-4">
                  <span className="mr-3 text-xl text-[#17633a]">⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="What agricultural product are you looking for?"
                    className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-[#89928a]"
                  />
                </div>

                <button
                  onClick={() =>
                    document
                      .getElementById("marketplace")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="rounded-xl bg-[#17633a] px-7 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b]"
                >
                  Search marketplace
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-[#6e796f]">
              <span>✓ Supplier profiles</span>
              <span>✓ Product availability</span>
              <span>✓ Regional sourcing</span>
            </div>
          </div>

          {/* African agricultural visual */}
          <div className="relative">
            <div className="overflow-hidden rounded-[2rem] bg-[#173d26] p-3 shadow-2xl shadow-[#173d26]/20">
              <div className="relative min-h-[390px] overflow-hidden rounded-[1.5rem] bg-[#315d39] p-8 text-white">
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full border-[55px] border-[#dce7d7]" />
                  <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full border-[60px] border-[#102e1c]" />
                  <div className="absolute right-10 top-1/2 h-24 w-24 rotate-45 border-2 border-[#dce7d7]" />
                </div>

                <div className="relative">
                  <div className="text-[10px] font-black tracking-[0.25em] text-[#cddfca]">
                    FROM FARM TO MARKET
                  </div>

                  <div className="mt-5 max-w-sm text-4xl font-black leading-tight">
                    Built for the way African agriculture trades.
                  </div>

                  <div className="mt-6 max-w-sm text-sm leading-6 text-[#d1ddd2]">
                    A marketplace connecting agricultural supply, commercial
                    demand and movement.
                  </div>
                </div>

                <div className="absolute bottom-8 left-8 right-8 grid grid-cols-3 gap-2">
                  {[
                    ["SOURCE", "Products"],
                    ["TRADE", "Buyers"],
                    ["MOVE", "Delivery"],
                  ].map(([title, label]) => (
                    <div
                      key={title}
                      className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur"
                    >
                      <div className="text-[9px] font-black tracking-widest text-[#cce0cb]">
                        {title}
                      </div>
                      <div className="mt-1 text-xs font-bold">{label}</div>
                    </div>
                  ))}
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
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
              Live marketplace concept
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Available agricultural supply
            </h2>
            <p className="mt-2 text-[#6c776e]">
              Explore products by category, quantity and location.
            </p>
          </div>

          <div className="text-xs font-semibold text-[#7a847c]">
            Demonstration listings
          </div>
        </div>

        {/* Category filters */}
        <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
          {["All", ...categories.map(([name]) => name)].map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition ${
                activeCategory === category
                  ? "bg-[#17633a] text-white"
                  : "border border-[#d7ded4] bg-white text-[#657067] hover:border-[#8ead95]"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {loading && (
          <div className="mt-6 rounded-2xl border border-[#dce2d9] bg-white p-8 text-center text-sm font-semibold text-[#69756c]">
            Loading available supply…
          </div>
        )}

        {error && !loading && (
          <div className="mt-6 rounded-2xl border border-[#e3caca] bg-[#fff8f8] p-8 text-center text-sm font-semibold text-[#8a4545]">
            Unable to load supply: {error}
          </div>
        )}

        {/* Product cards */}
        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {filteredProducts.map((product) => (
            <article
              key={product.id}
              className="overflow-hidden rounded-2xl border border-[#dce2d9] bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
            >
              <div
                className={`relative flex h-48 items-end overflow-hidden ${product.tone}`}
              >
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/10 to-transparent" />

                <div className="relative w-full px-5 pb-5">
                  <div className="text-[11px] font-black tracking-[0.2em] text-[#43564a]/70">
                    {product.category.toUpperCase()}
                  </div>
                  <div className="mt-1 text-3xl font-black tracking-tight text-[#304635]/80">
                    {product.visual}
                  </div>
                </div>

                <div className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                  {product.verified ? "✓ Verified" : "Supplier"}
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-lg font-black">{product.name}</h3>

                <div className="mt-2 text-sm font-semibold text-[#566258]">
                  {product.supplier}
                </div>

                <div className="mt-1 text-xs text-[#7c877e]">
                  📍 {product.location}
                </div>

                <div className="mt-4 rounded-xl bg-[#f4f6f1] px-3 py-3">
                  <div className="text-xs font-bold text-[#6d786f]">
                    AVAILABLE SUPPLY
                  </div>
                  <div className="mt-1 text-sm font-black text-[#27382b]">
                    {product.quantity}
                  </div>
                </div>

                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <span className="text-xl font-black text-[#17633a]">
                      {product.price}
                    </span>
                    <span className="ml-1 text-xs text-[#7b867d]">
                      {product.unit}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
  setOrderQuantity(1);
  setOrderError("");
  setSelectedProduct(product);
}}
                    className="rounded-lg bg-[#17633a] px-4 py-2 text-xs font-black text-white hover:bg-[#0f4d2b]"
                  >
                    View supply
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {selectedProduct && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedProduct.name} supply details`}
            onClick={() => setSelectedProduct(null)}
          >
            <div
              className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`relative flex h-48 items-end ${selectedProduct.tone}`}>
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/10 to-transparent" />
                <div className="relative w-full px-6 pb-6">
                  <div className="text-[11px] font-black tracking-[0.2em] text-[#43564a]/70">
                    {selectedProduct.category.toUpperCase()}
                  </div>
                  <div className="mt-1 text-4xl font-black tracking-tight text-[#304635]/80">
                    {selectedProduct.visual}
                  </div>
                </div>
                <div className="absolute right-5 top-5">
                  <button
                    type="button"
                    onClick={() => setSelectedProduct(null)}
                    className="rounded-full bg-white/90 px-3 py-2 text-sm font-black text-[#304635] hover:bg-white"
                    aria-label="Close supply details"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black text-[#27382b]">
                      {selectedProduct.name}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-[#566258]">
                      {selectedProduct.supplier}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-black text-[#17633a]">
                      {selectedProduct.price}
                    </div>
                    <div className="text-xs text-[#7b867d]">
                      {selectedProduct.unit}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-[#f4f6f1] p-4">
                    <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                      AVAILABLE
                    </div>
                    <div className="mt-1 text-sm font-black text-[#27382b]">
                      {selectedProduct.quantity}
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#f4f6f1] p-4">
                    <div className="text-[10px] font-black tracking-wider text-[#6d786f]">
                      LOCATION
                    </div>
                    <div className="mt-1 text-sm font-black text-[#27382b]">
                      {selectedProduct.location}
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-[#dce2d9] bg-[#f7f8f4] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#7b867d]">
                        Order quantity
                      </div>
                      <div className="mt-1 text-xs text-[#69756c]">
                        Available: {selectedProduct.quantity}
                      </div>
                    </div>

                    <div className="flex items-center rounded-xl border border-[#cfd8ce] bg-white">
                      <button
                        type="button"
                        onClick={() =>
                          setOrderQuantity((quantity) =>
                            Math.max(1, quantity - 1),
                          )
                        }
                        disabled={ordering || orderQuantity <= 1}
                        className="h-10 w-10 text-lg font-black text-[#17633a] disabled:opacity-40"
                        aria-label="Decrease order quantity"
                      >
                        −
                      </button>

                      <div className="flex h-10 min-w-12 items-center justify-center border-x border-[#dfe5dc] px-3 text-sm font-black">
                        {orderQuantity}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setOrderQuantity((quantity) =>
                            Math.min(
                              selectedProduct.availableQuantity,
                              quantity + 1,
                            ),
                          )
                        }
                        disabled={
                          ordering ||
                          orderQuantity >= selectedProduct.availableQuantity
                        }
                        className="h-10 w-10 text-lg font-black text-[#17633a] disabled:opacity-40"
                        aria-label="Increase order quantity"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {orderError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      {orderError}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-[#69756c]">
                      {selectedProduct.verified
                        ? "✓ Verified supplier"
                        : "Supplier profile"}
                    </div>

                    <button
                      type="button"
                      onClick={handleStartOrder}
                      disabled={ordering}
                      className="rounded-xl bg-[#17633a] px-5 py-3 text-xs font-black text-white hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {ordering ? "Placing order..." : "Start order"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {orderSuccess && (
          <div className="fixed bottom-6 right-6 z-[60] w-full max-w-sm rounded-2xl border border-[#cfe0cf] bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e5f1e4] text-sm font-black text-[#17633a]">
                ✓
              </div>

              <div className="min-w-0">
                <div className="text-sm font-black text-[#243229]">
                  Order placed
                </div>
                <div className="mt-1 text-xs leading-5 text-[#69756c]">
                  {orderSuccess.productName} • {orderSuccess.quantity} units
                </div>
                <div className="mt-2 text-xs font-black text-[#17633a]">
                  {orderSuccess.orderNumber}
                </div>
                <div className="mt-1 text-xs text-[#69756c]">
                  Total: R{orderSuccess.total} • {orderSuccess.status}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOrderSuccess(null)}
                className="text-lg font-bold text-[#7b867d] hover:text-[#344238]"
                aria-label="Dismiss order confirmation"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {filteredProducts.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-12 text-center text-sm text-[#69756c]">
            No matching supply found in this demonstration marketplace.
          </div>
        )}
      </section>

      {/* Buyer requests */}
      <section id="requests" className="border-y border-[#dfe4dc] bg-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
              Buyer demand
            </div>

            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              Can&apos;t find what you need?
            </h2>

            <p className="mt-4 max-w-xl leading-7 text-[#69756c]">
              Tell suppliers what you are looking for. Product requests can
              capture quantity, location, quality requirements and delivery
              needs.
            </p>

            <button className="mt-7 rounded-xl bg-[#17633a] px-6 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b]">
              Post a product request
            </button>
          </div>

          <div className="rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-6">
            <div className="text-xs font-black tracking-[0.18em] text-[#7b867d]">
              EXAMPLE REQUEST
            </div>

            <div className="mt-5 rounded-xl border border-[#dfe5dc] bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-black">Tomatoes</div>
                  <div className="mt-1 text-xs text-[#7a857d]">
                    Fresh produce • Grade 1
                  </div>
                </div>
                <div className="rounded-full bg-[#e8f1e6] px-3 py-1 text-[9px] font-black text-[#17633a]">
                  OPEN REQUEST
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-[#f5f6f2] p-3">
                  <div className="text-[9px] font-bold text-[#7d877f]">
                    QUANTITY
                  </div>
                  <div className="mt-1 font-black">3,000 kg</div>
                </div>

                <div className="rounded-lg bg-[#f5f6f2] p-3">
                  <div className="text-[9px] font-bold text-[#7d877f]">
                    DESTINATION
                  </div>
                  <div className="mt-1 font-black">Johannesburg</div>
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-[#f5f6f2] p-3 text-xs text-[#657067]">
                Required by 05 October • Delivery required
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
            Agricultural supply
          </div>
          <h2 className="mt-2 text-3xl font-black tracking-tight">
            Explore categories
          </h2>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {categories.map(([name, description], index) => (
            <button
              key={name}
              className="group rounded-2xl border border-[#dce2d9] bg-white p-6 text-left transition hover:border-[#9ab39e] hover:bg-[#f1f5ef] hover:shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black tracking-[0.18em] text-[#9aa39c]">
                  0{index + 1}
                </span>
                <span className="text-lg text-[#17633a] transition group-hover:translate-x-1">
                  →
                </span>
              </div>

              <h3 className="mt-7 text-lg font-black">{name}</h3>
              <p className="mt-2 text-sm leading-6 text-[#717c73]">
                {description}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="orders" className="border-y border-[#dfe4dc] bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#17633a]">
                Buyer workspace
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-[#17251b]">
                My Orders
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#69756c]">
                Track your agricultural purchases, order status and delivery
                details from one place.
              </p>
            </div>

            <div className="rounded-xl border border-[#dce2d9] bg-[#f7f8f4] px-4 py-3 text-xs font-bold text-[#5d695f]">
              {orders.length} {orders.length === 1 ? "order" : "orders"}
            </div>
          </div>

          <div className="mt-8">
            {ordersLoading ? (
              <div className="rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-8 text-center">
                <div className="text-sm font-bold text-[#17633a]">
                  Loading your orders...
                </div>
              </div>
            ) : ordersError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
                <div className="text-sm font-black text-red-700">
                  Unable to load orders
                </div>
                <div className="mt-1 text-xs text-red-600">
                  {ordersError}
                </div>
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl border border-[#dce2d9] bg-[#f7f8f4] p-10 text-center">
                <div className="text-sm font-black text-[#243229]">
                  No orders yet
                </div>
                <div className="mt-2 text-xs leading-5 text-[#69756c]">
                  Browse the marketplace above and start your first order.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-[#dce2d9] bg-[#fbfcf9] p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-sm font-black text-[#17251b]">
                            {order.orderNumber}
                          </div>

                          <span className="rounded-full bg-[#e5f1e4] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                            {order.status.replaceAll("_", " ")}
                          </span>
                        </div>

                        <div className="mt-2 text-xs text-[#7b867d]">
                          {new Date(order.createdAt).toLocaleDateString(
                            "en-ZA",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            },
                          )}
                        </div>
                      </div>

                      <div className="text-left md:text-right">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                          Order total
                        </div>
                        <div className="mt-1 text-xl font-black text-[#17633a]">
                          R{order.total}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 border-t border-[#e3e8e0] pt-5 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                          Items
                        </div>

                        <div className="mt-2 space-y-2">
                          {order.items.map((item) => (
                            <div
                              key={`${order.id}-${item.productName}`}
                              className="flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                              <span className="font-bold text-[#344238]">
                                {item.productName}
                              </span>
                              <span className="text-[#69756c]">
                                {item.quantity} × R{item.unitPrice}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="md:min-w-56">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                          Delivery
                        </div>
                        <div className="mt-2 text-xs font-bold text-[#344238]">
                          {order.deliveryAddress.city},{" "}
                          {order.deliveryAddress.province}
                        </div>
                        <div className="mt-1 text-xs text-[#69756c]">
                          {order.deliveryAddress.country}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-[#163b25] text-white">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="max-w-2xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#b7d0b9]">
              How BonAgri works
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
              From agricultural supply to market.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {workflow.map(([number, title, description]) => (
              <div
                key={number}
                className="rounded-2xl border border-white/10 bg-white/5 p-6"
              >
                <div className="text-xs font-black tracking-[0.2em] text-[#9fbea3]">
                  {number}
                </div>
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#c5d3c7]">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supplier CTA */}
      <section id="suppliers" className="mx-auto max-w-7xl px-6 py-20">
        <div className="rounded-[2rem] border border-[#d7dfd4] bg-[#e9eee4] p-8 md:p-14">
          <div className="max-w-3xl">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-[#17633a]">
              For farmers & suppliers
            </div>

            <h2 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">
              List what you grow. Reach more buyers.
            </h2>

            <p className="mt-5 max-w-2xl leading-7 text-[#637067]">
              Build your supplier profile, publish available agricultural
              products and respond to commercial demand through BonAgri.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button className="rounded-xl bg-[#17633a] px-6 py-3.5 text-sm font-black text-white hover:bg-[#0f4d2b]">
                Become a supplier
              </button>
              <button className="rounded-xl border border-[#bfcabd] bg-white px-6 py-3.5 text-sm font-black text-[#344238]">
                Learn more
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#dfe4dc] bg-[#f0f1ec]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="flex flex-col justify-between gap-8 md:flex-row">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#17633a] text-sm font-black text-white">
                  B
                </div>
                <span className="font-black">BonAgri</span>
              </div>

              <p className="mt-4 max-w-sm text-sm leading-6 text-[#707a71]">
                Agricultural trade, connected — from producers and suppliers to
                buyers and markets.
              </p>
            </div>

            <div className="text-sm text-[#69746b]">
              <div className="font-black text-[#344238]">
                Limpopo — A Home of Agriculture
              </div>
              <div className="mt-2">South Africa • Regional agricultural trade</div>
            </div>
          </div>

          <div className="mt-10 border-t border-[#d8ddd5] pt-6 text-xs text-[#7b857c]">
            © 2026 BonAgri. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
