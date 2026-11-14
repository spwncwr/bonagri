"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { BrandLogo } from "../../components/brand/logo";
import { CHECKOUT_NOTES_KEY } from "../../components/mobile/cart-screen";
import { ArrowLeftIcon, CheckIcon } from "../../components/mobile/icons";
import { authHeaders } from "../../lib/auth";
import { goBackOr } from "../../lib/navigation";
import {
  CHECKOUT_PAYMENT_METHOD_KEY,
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHODS,
  isSelectablePaymentMethod,
  paymentMethodLabel,
  type PaymentMethodId,
} from "../../lib/payment-methods";

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
  lat: number | null;
  lng: number | null;
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>(
    DEFAULT_PAYMENT_METHOD,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[] | null>(null);
  // CP17: machine-readable gate code from a 403 checkout — routes the buyer
  // to the right verification screen instead of showing a dead-end error.
  const [blockedCode, setBlockedCode] = useState<string | null>(null);

  // True back: return to the screen the buyer came from (usually the cart).
  // Fresh deep links fall back to the cart — see lib/navigation.ts.
  function goBack() {
    goBackOr(router, "/cart");
  }

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

        // Delivery instructions typed on the mobile cart screen carry over
        // into the existing notes field (then clear, so a later checkout
        // starts fresh).
        const storedNotes = window.sessionStorage.getItem(CHECKOUT_NOTES_KEY);

        if (storedNotes) {
          setNotes(storedNotes);
          window.sessionStorage.removeItem(CHECKOUT_NOTES_KEY);
        }

        // HP1: restore the payment-method choice (same hand-off pattern as
        // notes). A stale/unknown value falls back to the default.
        const storedMethod = window.sessionStorage.getItem(
          CHECKOUT_PAYMENT_METHOD_KEY,
        );
        if (isSelectablePaymentMethod(storedMethod)) {
          setPaymentMethod(storedMethod);
        } else {
          setPaymentMethod(DEFAULT_PAYMENT_METHOD);
        }
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

  function choosePaymentMethod(id: PaymentMethodId) {
    setPaymentMethod(id);
    // Persist so the choice survives a refresh and can be echoed on the
    // success screen; the API body is intentionally unchanged (plan D1).
    window.sessionStorage.setItem(CHECKOUT_PAYMENT_METHOD_KEY, id);
  }

  async function placeOrders() {
    if (!canPlace) return;

    setPlacing(true);
    setError("");
    setBlockedCode(null);

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
        const code =
          typeof data?.code === "string" ? (data.code as string) : null;
        setBlockedCode(response.status === 403 ? code : null);
        throw new Error(
          Array.isArray(data?.message)
            ? data.message.join(", ")
            : data?.message || "Unable to place your orders",
        );
      }

      setBlockedCode(null);
      // HP1: record the method that was actually in effect for these orders —
      // the default selection never touches choosePaymentMethod(), and the
      // order-detail echo reads this hand-off (sessionStorage, plan D1).
      window.sessionStorage.setItem(CHECKOUT_PAYMENT_METHOD_KEY, paymentMethod);
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
          <div className="mx-auto max-w-2xl px-4 py-10">
            <div className="rounded-2xl border border-[#cfe0cf] bg-white p-5 text-center shadow-sm sm:p-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e5f1e4] text-[#17633a]">
                <CheckIcon className="h-7 w-7" strokeWidth={3} />
              </div>

              <h1 className="mt-4 text-xl font-black tracking-tight text-[#17251b] sm:text-2xl">
                {placedOrders.length === 1
                  ? "Order placed"
                  : `${placedOrders.length} orders placed`}
              </h1>

              <p className="mt-2 text-sm leading-6 text-[#69756c]">
                Each supplier received their order. Track every one of them
                from your orders list.
              </p>

              {/* HP1: echo the chosen method — the orders themselves carry no
                  payment field yet (the CP11 EFT evidence flow owns that). */}
              <p className="mt-3 text-sm font-bold text-[#243229]">
                Payment method: {paymentMethodLabel(paymentMethod)}
              </p>

              <div className="mt-6 space-y-3 text-left">
                {placedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#dce2d9] bg-[#fbfcf9] px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-[#17251b]">
                        {order.orderNumber}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[#69756c]">
                        {order.supplierName}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-black text-[#17633a]">
                      R{Number(order.total).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => router.push("/orders")}
                  className="w-full rounded-full bg-[#17633a] px-6 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] sm:w-auto"
                >
                  View my orders
                </button>

                <Link
                  href="/"
                  className="w-full rounded-full border border-[#dce2d9] bg-white px-6 py-3.5 text-sm font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99] sm:w-auto"
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
          <div className="mx-auto max-w-2xl px-4 py-4">
            <div className="min-w-0">
              <BrandLogo height={22} />
              <h1 className="mt-2 text-xl font-black tracking-tight text-[#17251b]">
                Checkout
              </h1>
              <p className="mt-1 text-xs leading-5 text-[#7c877e]">
                One order per supplier — all placed together.
              </p>
            </div>

            {/* Own action row so the title never squeezes on thin phones. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                Back
              </button>

              <Link
                href="/orders"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                My Orders
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          {/* CP17: a verification gate replaces the generic error with an
              action — the buyer clears it without hunting through settings. */}
          {error && blockedCode === "PHONE_VERIFICATION_REQUIRED" ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <p className="font-black">Verify your phone to place orders</p>
              <p className="mt-1 leading-6">{error}</p>
              <Link
                href="/settings"
                className="mt-2 inline-block rounded-lg bg-[#17633a] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#12512f]"
              >
                Verify now
              </Link>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-[#dce2d9] bg-white p-8 text-center">
              <div className="text-sm font-bold text-[#17633a]">
                Loading your cart...
              </div>
            </div>
          ) : cartItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-8 text-center">
              <div className="text-base font-black text-[#243229]">
                Your cart is empty
              </div>
              <p className="mt-2 text-sm text-[#69756c]">
                Browse the marketplace and add produce before checking out.
              </p>
              <Link
                href="/"
                className="mt-6 inline-block rounded-full bg-[#17633a] px-6 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99]"
              >
                Browse marketplace
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
              <div className="space-y-4">
                {/* Delivery address */}
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                      Deliver to
                    </h2>

                    <Link
                      href="/addresses"
                      className="shrink-0 text-xs font-bold text-[#17633a] hover:underline"
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
                            className="mt-1 shrink-0 accent-[#17633a]"
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-[#17251b]">
                              {address.label}
                              {address.isDefault ? (
                                <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                                  Default
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-[#69756c]">
                              {address.recipientName} — {address.addressLine1},{" "}
                              {address.city}
                              {address.province ? `, ${address.province}` : ""}
                            </span>
                            {/* Pin status is informational only — checkout is
                                never blocked by a missing destination pin. */}
                            <span
                              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                                address.lat != null && address.lng != null
                                  ? "bg-[#e5f1e4] text-[#17633a]"
                                  : "bg-[#eee8c9] text-[#8a6d12]"
                              }`}
                            >
                              {address.lat != null && address.lng != null
                                ? "Location confirmed"
                                : "Needs location confirmation"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>

                {/* HP1: payment method — Manual EFT is the only live option;
                    PayFast/Ozow are honest "Coming soon" placeholders (plan D1:
                    selection is UI-only, the checkout API body is unchanged). */}
                <section
                  aria-label="Payment method"
                  className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5"
                >
                  <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    Payment method
                  </h2>

                  <div className="mt-4 space-y-2">
                    {PAYMENT_METHODS.map((method) => {
                      const selected = paymentMethod === method.id;

                      if (!method.available) {
                        return (
                          <div
                            key={method.id}
                            aria-disabled="true"
                            className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-dashed border-[#cfd8ce] bg-[#fbfcf9] px-4 py-3 opacity-70"
                          >
                            <span className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-[#cfd8ce]" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-[#7b867d]">
                                {method.label}
                                <span className="ml-2 rounded-full bg-[#eee8c9] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#8a6d12]">
                                  Coming soon
                                </span>
                              </span>
                              <span className="mt-0.5 block text-xs leading-5 text-[#9aa49b]">
                                {method.detail}
                              </span>
                            </span>
                          </div>
                        );
                      }

                      return (
                        <label
                          key={method.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                            selected
                              ? "border-[#17633a] bg-[#f0f7f1]"
                              : "border-[#dce2d9] hover:bg-[#f7f8f4]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="payment-method"
                            value={method.id}
                            checked={selected}
                            onChange={() => choosePaymentMethod(method.id)}
                            className="mt-1 shrink-0 accent-[#17633a]"
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-[#17251b]">
                              {method.label}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-[#69756c]">
                              {method.detail}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
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
                        className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 truncate text-sm font-black text-[#17251b]">
                            {group.supplierName}
                          </div>
                          <div className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
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

                              <div className="shrink-0 text-sm font-black text-[#17633a]">
                                R{Number(item.lineTotal).toFixed(2)}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e3e8e0] pt-4 text-sm font-black text-[#243229]">
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
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
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
                    className="mt-2 w-full rounded-xl border border-[#cfd8ce] bg-[#fbfcf9] px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </section>
              </div>

              {/* Summary */}
              <aside className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5 lg:sticky lg:top-6">
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
                  className="mt-5 w-full rounded-full bg-[#17633a] py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
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
