"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../../components/auth/auth-guard";
import { BrandLogo } from "../../../components/brand/logo";
import CheckoutStepper from "../../../components/checkout/stepper";
import LocationPicker from "../../../components/addresses/location-picker";
import { ArrowLeftIcon, MapPinIcon } from "../../../components/mobile/icons";
import { authHeaders } from "../../../lib/auth";
import {
  CheckoutQuoteDraft,
  readCheckoutAddressId,
  readCheckoutNotes,
  readCheckoutQuote,
  writeCheckoutAddressId,
  writeCheckoutNotes,
} from "../../../lib/checkout-draft";
import { goBackOr } from "../../../lib/navigation";

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
  addressLine2: string | null;
  city: string;
  province: string | null;
  isDefault: boolean;
  lat: number | null;
  lng: number | null;
};

// C1 (plan §6): the delivery step owns everything about WHERE the order
// goes — address selection, the map pin, and delivery instructions — and
// nothing else. Its drafts hand off to /checkout via sessionStorage.
export default function DeliveryPage() {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // F1: quote mode — an accepted quote draft replaces the cart contents
  // entirely (the cart guard is skipped; the summary shows the quote).
  const [quote, setQuote] = useState<CheckoutQuoteDraft | null>(null);

  // Delivery-destination pin sheet — saves {lat, lng} onto the selected
  // address only; the manual address text is never modified from here.
  const [pickingPin, setPickingPin] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState("");

  function goBack() {
    // Quote flow starts from the request card; cart flow from the cart.
    goBackOr(router, quote ? "/requests" : "/cart");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDelivery() {
      try {
        setLoading(true);
        setError("");

        const quoteDraft = readCheckoutQuote();
        setQuote(quoteDraft);

        // Quote mode never touches the cart — an empty cart must not
        // bounce this flow to the empty-cart card.
        const [cartResponse, addressResponse] = await Promise.all([
          quoteDraft
            ? Promise.resolve(null)
            : fetch(`${API_BASE_URL}/api/cart`, {
                cache: "no-store",
                headers: authHeaders(),
              }),
          fetch(`${API_BASE_URL}/api/addresses`, {
            cache: "no-store",
            headers: authHeaders(),
          }),
        ]);

        if (cartResponse && !cartResponse.ok) {
          throw new Error(`Cart request failed: ${cartResponse.status}`);
        }

        if (!addressResponse.ok) {
          throw new Error(
            `Addresses request failed: ${addressResponse.status}`,
          );
        }

        const cartData = cartResponse ? await cartResponse.json() : [];
        const addressData = await addressResponse.json();

        if (cancelled) {
          return;
        }

        const loadedAddresses = Array.isArray(addressData)
          ? (addressData as Address[])
          : [];

        setCartItems(Array.isArray(cartData) ? (cartData as CartItem[]) : []);
        setAddresses(loadedAddresses);

        // Restore the draft from a previous visit to this step; an unknown
        // or stale id (deleted address) falls back to the default.
        const storedAddressId = readCheckoutAddressId();
        const draftIsValid = loadedAddresses.some(
          (address) => address.id === storedAddressId,
        );
        const fallback =
          loadedAddresses.find((address) => address.isDefault) ??
          loadedAddresses[0];

        setSelectedAddressId(
          draftIsValid
            ? storedAddressId
            : (fallback?.id ?? ""),
        );

        setNotes(readCheckoutNotes());
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load your delivery details.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDelivery();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAddress =
    addresses.find((address) => address.id === selectedAddressId) ??
    undefined;
  // Quote mode only needs an address — the cart can be (and usually is)
  // empty; cart mode still requires items.
  const canContinue = quote
    ? Boolean(selectedAddressId)
    : cartItems.length > 0 && Boolean(selectedAddressId);

  function continueToPayment() {
    if (!canContinue) return;

    // Draft hand-off: checkout renders these read-only and sends them with
    // the unchanged POST /api/cart/checkout body.
    writeCheckoutAddressId(selectedAddressId);
    writeCheckoutNotes(notes);
    router.push("/checkout");
  }

  function openPinSheet() {
    if (!selectedAddress) return;
    setPinDraft(
      selectedAddress.lat != null && selectedAddress.lng != null
        ? { lat: selectedAddress.lat, lng: selectedAddress.lng }
        : null,
    );
    setPinError("");
    setPickingPin(true);
  }

  async function savePin() {
    if (!selectedAddress || !pinDraft || pinSaving) return;

    setPinSaving(true);
    setPinError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/addresses/${selectedAddress.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          // Explicit paired values: a number sets the pin, null clears it.
          body: JSON.stringify({ lat: pinDraft.lat, lng: pinDraft.lng }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to save the delivery location",
        );
      }

      // Refresh the list so the badge flips to "Location confirmed".
      const refreshed = await fetch(`${API_BASE_URL}/api/addresses`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (refreshed.ok) {
        const refreshedData = await refreshed.json();
        if (Array.isArray(refreshedData)) {
          setAddresses(refreshedData as Address[]);
        }
      }

      setPickingPin(false);
    } catch (err) {
      setPinError(
        err instanceof Error
          ? err.message
          : "Unable to save the delivery location",
      );
    } finally {
      setPinSaving(false);
    }
  }

  return (
    <AuthGuard requiredRole="BUYER">
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto max-w-2xl px-4 py-4">
            <div className="min-w-0">
              <BrandLogo height={22} />
              <h1 className="mt-2 text-xl font-black tracking-tight text-[#17251b]">
                Delivery
              </h1>
              <p className="mt-1 text-xs leading-5 text-[#7c877e]">
                Where should we drop it off?
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
          <CheckoutStepper current="delivery" />

          {error ? (
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
                Loading delivery details...
              </div>
            </div>
          ) : !quote && cartItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-8 text-center">
              <div className="text-base font-black text-[#243229]">
                Your cart is empty
              </div>
              <p className="mt-2 text-sm text-[#69756c]">
                Add produce first — delivery details are confirmed per order.
              </p>
              <Link
                href="/cart"
                className="mt-6 inline-block rounded-full bg-[#17633a] px-6 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99]"
              >
                Back to cart
              </Link>
            </div>
          ) : (
            <>
              {/* F1: quote mode shows WHAT is being ordered (the agreed
                  quote) instead of cart line items — everything below is
                  shared with the cart flow. */}
              {quote ? (
                <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
                  <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    Your quote order
                  </h2>
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#17251b]">
                        {quote.product}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-[#69756c]">
                        {quote.supplier} •{" "}
                        {quote.quantity.toLocaleString("en-ZA")} {quote.unit}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black text-[#17633a]">
                        R{" "}
                        {quote.quotedPrice.toLocaleString("en-ZA", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#7b867d]">
                        agreed price
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-[#7a857d]">
                    Total: R{" "}
                    {(quote.quotedPrice * quote.quantity).toLocaleString(
                      "en-ZA",
                      { minimumFractionDigits: 2 },
                    )}{" "}
                    — charged at the agreed quote price, not the catalog
                    price.
                  </p>
                </section>
              ) : null}
              {/* Address selection — the concern that used to live (twice)
                  in the cart and checkout screens. */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-1.5 text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    <MapPinIcon className="h-3.5 w-3.5" />
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
                    to continue.
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
                            {address.recipientName} — {address.addressLine1},
                            {" "}
                            {address.city}
                            {address.province ? `, ${address.province}` : ""}
                          </span>
                          {/* Pin status is informational only — the order is
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

              {/* Map pin confirmation for the selected address. */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[#7b867d]">
                  Delivery location
                </h2>

                {selectedAddress ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[#17251b]">
                        {selectedAddress.label}
                      </div>
                      <div className="mt-0.5 text-xs leading-5 text-[#69756c]">
                        {selectedAddress.city} ·{" "}
                        {selectedAddress.lat != null &&
                        selectedAddress.lng != null
                          ? "pin on the map"
                          : "no pin dropped yet"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={openPinSheet}
                      className="shrink-0 rounded-full border border-[#17633a] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-[#17633a] transition hover:bg-[#eaf2e8]"
                    >
                      {selectedAddress.lat != null &&
                      selectedAddress.lng != null
                        ? "Edit on map"
                        : "Set location"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-[#cbd5ca] p-3 text-xs leading-5 text-[#69756c]">
                    Select an address above to confirm its drop-off pin.
                  </div>
                )}
              </section>

              {/* Optional delivery instructions — sent as checkout notes. */}
              <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
                <label
                  htmlFor="delivery-notes"
                  className="text-sm font-black text-[#243229]"
                >
                  Delivery instructions{" "}
                  <span className="font-medium text-[#7b867d]">(optional)</span>
                </label>
                <textarea
                  id="delivery-notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Gate code, best delivery time, quality requirements..."
                  className="mt-2 w-full rounded-xl border border-[#cfd8ce] bg-[#fbfcf9] px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </section>

              <button
                type="button"
                onClick={continueToPayment}
                disabled={!canContinue}
                className="w-full rounded-full bg-[#17633a] py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue to payment
              </button>

              {!canContinue && addresses.length === 0 ? (
                <p className="text-center text-xs font-semibold text-[#7b867d]">
                  Add a delivery address to continue.
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Delivery-destination pin sheet — map/GPS selection for the
            address being delivered to; saving confirms it explicitly. */}
        {pickingPin && selectedAddress ? (
          <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40">
            <div
              className="absolute inset-0"
              onClick={() => {
                if (!pinSaving) setPickingPin(false);
              }}
            />

            <div className="relative z-10 max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#cbd5ca]" />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-black text-[#17251b]">
                    Delivery location
                  </h2>
                  <p className="mt-0.5 text-xs leading-4 text-[#69756c]">
                    {selectedAddress.label} — {selectedAddress.addressLine1},{" "}
                    {selectedAddress.city}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPickingPin(false)}
                  disabled={pinSaving}
                  aria-label="Close location picker"
                  className="shrink-0 rounded-full border border-[#dce2d9] px-2.5 py-1 text-xs font-black text-[#344238] transition hover:bg-[#f7f8f4] disabled:opacity-50"
                >
                  ✕
                </button>
              </div>

              <LocationPicker
                className="mt-3"
                lat={pinDraft?.lat ?? null}
                lng={pinDraft?.lng ?? null}
                onChange={setPinDraft}
              />

              {pinError ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  {pinError}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void savePin()}
                  disabled={!pinDraft || pinSaving}
                  className="flex-1 rounded-full bg-[#17633a] px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pinSaving
                    ? "Saving..."
                    : pinDraft
                      ? "Confirm location"
                      : "Drop a pin first"}
                </button>
                <button
                  type="button"
                  onClick={() => setPickingPin(false)}
                  disabled={pinSaving}
                  className="rounded-full border border-[#dce2d9] bg-white px-5 py-3 text-sm font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </AuthGuard>
  );
}
