"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type CartItem = {
  id: string;
  quantity: number;
  lineTotal: number;
  availableQuantity: number;
  inStock: boolean;
  product: {
    id: string;
    name: string;
    unit: string;
    price: string;
    supplierName: string;
  };
};

type Address = {
  id: string;
  label: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  province: string | null;
  isDefault: boolean;
};

type PlacedOrder = {
  id: string;
  orderNumber: string;
  supplierName: string;
  total: string;
};

export default function CheckoutPage() {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCheckout() {
      try {
        setLoading(true);
        setError("");

        const [cartResponse, addressResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/cart`, {
            cache: "no-store",
            headers: authHeaders(),
          }),
          fetch(`${API_BASE_URL}/api/addresses`, {
            cache: "no-store",
            headers: authHeaders(),
          }),
        ]);

        if (!cartResponse.ok) {
          throw new Error(`Cart request failed: ${cartResponse.status}`);
        }

        if (!addressResponse.ok) {
          throw new Error(
            `Addresses request failed: ${addressResponse.status}`,
          );
        }

        const cartData = await cartResponse.json();
        const addressData = await addressResponse.json();

        if (cancelled) {
          return;
        }

        setCartItems(Array.isArray(cartData) ? (cartData as CartItem[]) : []);
        setAddresses(Array.isArray(addressData) ? (addressData as Address[]) : []);

        const defaultAddress = Array.isArray(addressData)
          ? (addressData as Address[]).find(
              (address) => address.isDefault,
            ) ?? (addressData as Address[])[0]
          : undefined;

        setSelectedAddressId(defaultAddress?.id ?? "");
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load your checkout.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCheckout();

    return () => {
      cancelled = true;
    };
  }, []);

  // One preview card per supplier - mirrors how the API splits the checkout
  // into one order per supplier.
  const supplierGroups = useMemo(() => {
    const groups = new Map<
      string,
      { supplierName: string; items: CartItem[]; total: number }
    >();

    for (const item of cartItems) {
      const key = item.product.supplierName;
      const group = groups.get(key) ?? {
        supplierName: key,
        items: [],
        total: 0,
      };
      group.items.push(item);
      group.total += Number(item.lineTotal);
      groups.set(key, group);
    }

    return Array.from(groups.values());
  }, [cartItems]);

  const orderCount = supplierGroups.length;
  const cartTotal = cartItems.reduce(
    (total, item) => total + Number(item.lineTotal),
    0,
  );
  const allInStock = cartItems.every((item) => item.inStock);
  const canPlace =
    cartItems.length > 0 && allInStock && Boolean(selectedAddressId) && !placing;

  async function placeOrders() {
    if (!canPlace) return;

    setPlacing(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/cart/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          deliveryAddressId: selectedAddressId,
          notes: notes.trim() ? notes.trim() : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to place your orders",
        );
      }

      setPlacedOrders(
        Array.isArray(data?.orders) ? (data.orders as PlacedOrder[]) : [],
      );
      setCartItems([]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to place your orders",
      );
    } finally {
      setPlacing(false);
    }
  }

  if (placedOrders) {
    return (
      <AuthGuard requiredRole="BUYER">
        <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
          <div className="mx-auto max-w-2xl px-6 py-16">
            <div className="rounded-2xl border border-[#cfe0cf] bg-white p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e5f1e4] text-xl font-black text-[#17633a]">
                ✓
              </div>

              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                {placedOrders.length === 1
                  ? "Order placed"
                  : `${placedOrders.length} orders placed`}
              </h1>

              <p className="mt-2 text-sm text-[#69756c]">
                Each supplier received their order. Track every one of them
                from your orders list.
              </p>

              <div className="mt-6 space-y-3 text-left">
                {placedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-xl border border-[#dce2d9] bg-[#fbfcf9] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-black text-[#17251b]">
                        {order.orderNumber}
                      </div>
                      <div className="mt-0.5 text-xs text-[#69756c]">
                        {order.supplierName}
                      </div>
                    </div>
                    <div className="text-sm font-black text-[#17633a]">
                      R{Number(order.total).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => router.push("/#orders")}
                  className="rounded-xl bg-[#17633a] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
                >
                  View my orders
                </button>

                <Link
                  href="/"
                  className="rounded-xl border border-[#dce2d9] bg-white px-6 py-3 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
                >
                  Continue shopping
                </Link>
              </div>
            </div>
          </div>
        </main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard requiredRole="BUYER">
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#17633a]">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Checkout
              </h1>
              <p className="mt-1 text-sm text-[#69756c]">
                One order per supplier — all placed together.
              </p>
            </div>

            <Link
              href="/#orders"
              className="rounded-xl border border-[#dce2d9] bg-white px-4 py-2 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
            >
              ← My Orders
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6 py-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-[#dce2d9] bg-white p-10 text-center">
              <div className="text-sm font-semibold text-[#17633a]">
                Loading your cart...
              </div>
            </div>
          ) : cartItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-10 text-center">
              <div className="text-lg font-semibold text-[#243229]">
                Your cart is empty
              </div>
              <p className="mt-2 text-sm text-[#69756c]">
                Browse the marketplace and add produce before checking out.
              </p>
              <Link
                href="/"
                className="mt-6 inline-block rounded-xl bg-[#17633a] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Browse marketplace
              </Link>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
              <div className="space-y-6">
                {/* Delivery address */}
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                      Deliver to
                    </h2>

                    <Link
                      href="/addresses"
                      className="text-xs font-semibold text-[#17633a] hover:underline"
                    >
                      Manage addresses
                    </Link>
                  </div>

                  {addresses.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-[#cbd5ca] p-4 text-sm text-[#69756c]">
                      No delivery addresses yet.{" "}
                      <Link
                        href="/addresses"
                        className="font-semibold text-[#17633a] hover:underline"
                      >
                        Add one
                      </Link>{" "}
                      to place an order.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-2">
                      {addresses.map((address) => (
                        <label
                          key={address.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                            selectedAddressId === address.id
                              ? "border-[#17633a] bg-[#f0f7f1]"
                              : "border-[#dce2d9] hover:bg-[#f7f8f4]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="delivery-address"
                            value={address.id}
                            checked={selectedAddressId === address.id}
                            onChange={(event) =>
                              setSelectedAddressId(event.target.value)
                            }
                            className="mt-1 accent-[#17633a]"
                          />

                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-[#17251b]">
                              {address.label}
                              {address.isDefault ? (
                                <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                                  Default
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-[#69756c]">
                              {address.recipientName} — {address.addressLine1},{" "}
                              {address.city}
                              {address.province ? `, ${address.province}` : ""}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>

                {/* Per-supplier order preview */}
                <section>
                  <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    Your orders ({orderCount})
                  </h2>

                  <div className="mt-3 space-y-4">
                    {supplierGroups.map((group) => (
                      <div
                        key={group.supplierName}
                        className="rounded-2xl border border-[#dce2d9] bg-white p-5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-black text-[#17251b]">
                            {group.supplierName}
                          </div>
                          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                            1 order
                          </div>
                        </div>

                        <div className="mt-4 space-y-3">
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start justify-between gap-3 border-b border-[#e9ede7] pb-3 last:border-b-0 last:pb-0"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[#17251b]">
                                  {item.product.name}
                                </div>
                                <div className="mt-0.5 text-xs text-[#69756c]">
                                  {item.quantity} {item.product.unit} × R
                                  {Number(item.product.price)}
                                </div>
                                {!item.inStock ? (
                                  <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-red-600">
                                    Only {item.availableQuantity} available —
                                    adjust your cart to continue
                                  </div>
                                ) : null}
                              </div>

                              <div className="text-sm font-black text-[#17633a]">
                                R{Number(item.lineTotal).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-[#e3e8e0] pt-4 text-sm font-black text-[#243229]">
                          <span>Order subtotal</span>
                          <span className="text-[#17633a]">
                            R{group.total.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Notes */}
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-6">
                  <label
                    htmlFor="checkout-notes"
                    className="text-sm font-black text-[#243229]"
                  >
                    Delivery notes{" "}
                    <span className="font-medium text-[#7b867d]">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    id="checkout-notes"
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Gate code, best delivery time, quality requirements..."
                    className="mt-2 w-full rounded-xl border border-[#cfd8ce] bg-[#fbfcf9] px-4 py-3 text-sm outline-none focus:border-[#17633a]"
                  />
                </section>
              </div>

              {/* Summary */}
              <aside className="rounded-2xl border border-[#dce2d9] bg-white p-6 lg:sticky lg:top-6">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                  Summary
                </h2>

                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-[#69756c]">Items</dt>
                    <dd className="font-bold text-[#243229]">
                      {cartItems.length}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-[#69756c]">Orders to place</dt>
                    <dd className="font-bold text-[#243229]">{orderCount}</dd>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#e3e8e0] pt-3 text-base">
                    <dt className="font-black text-[#243229]">Total</dt>
                    <dd className="font-black text-[#17633a]">
                      R{cartTotal.toFixed(2)}
                    </dd>
                  </div>
                </dl>

                {!allInStock ? (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                    Some items are out of stock. Adjust quantities in your
                    cart.
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={placeOrders}
                  disabled={!canPlace}
                  className="mt-5 w-full rounded-xl bg-[#17633a] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {placing
                    ? "Placing orders..."
                    : `Place ${orderCount} ${orderCount === 1 ? "order" : "orders"}`}
                </button>

                <p className="mt-3 text-center text-[11px] leading-4 text-[#7b867d]">
                  One order per supplier so each can fulfil independently.
                </p>
              </aside>
            </div>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
