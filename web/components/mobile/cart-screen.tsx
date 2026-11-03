"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRightIcon, MapPinIcon, MinusIcon, PlusIcon, TrashIcon } from "./icons";

export const CHECKOUT_NOTES_KEY = "bonagri_checkout_notes";

export type CartScreenItem = {
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

export type CartScreenAddress = {
  id: string;
  label: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  isDefault: boolean;
};

type CartScreenProps = {
  items: CartScreenItem[];
  addresses: CartScreenAddress[];
  error: string;
  onPatch: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onBrowse: () => void;
};

export default function CartScreen({
  items,
  addresses,
  error,
  onPatch,
  onRemove,
  onBrowse,
}: CartScreenProps) {
  const router = useRouter();
  const [notes, setNotes] = useState("");

  const total = items.reduce((sum, item) => sum + Number(item.lineTotal), 0);
  const supplierCount = new Set(
    items.map((item) => item.product.supplierName),
  ).size;
  const allInStock = items.every((item) => item.inStock);
  const defaultAddress =
    addresses.find((address) => address.isDefault) ?? addresses[0];

  function proceedToCheckout() {
    const trimmed = notes.trim();

    if (trimmed) {
      window.sessionStorage.setItem(CHECKOUT_NOTES_KEY, trimmed);
    }

    router.push("/checkout");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight">Cart</h1>
          <p className="mt-0.5 text-xs text-[#69756c]">
            {items.length} {items.length === 1 ? "item" : "items"}
            {supplierCount > 1 ? ` · ${supplierCount} supplier orders` : ""}
          </p>
        </div>
        {items.length > 0 ? (
          <span className="rounded-full bg-[#eaf3ec] px-3 py-1 text-[11px] font-black text-[#17633a]">
            R{total.toFixed(2)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#cbd5ca] bg-white p-10 text-center">
          <div className="text-sm font-black text-[#243229]">
            Your cart is empty
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[#69756c]">
            Browse the marketplace and add produce to your cart.
          </p>
          <button
            type="button"
            onClick={onBrowse}
            className="mt-5 rounded-xl bg-[#17633a] px-5 py-3 text-xs font-black text-white hover:bg-[#0f4d2b]"
          >
            Explore products
          </button>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            {items.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-[#dce2d9] bg-white p-3.5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#eef3ec] text-lg font-black text-[#43564a]">
                    {item.product.name.charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-black leading-snug text-[#17251b]">
                      {item.product.name}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-[#7c877e]">
                      {item.product.supplierName} · R
                      {Number(item.product.price)}/{item.product.unit}
                    </div>

                    {!item.inStock ? (
                      <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-red-600">
                        Only {item.availableQuantity} left — reduce quantity to
                        check out
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.product.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9aa49b] transition hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center rounded-full border border-[#cfd8ce] bg-white">
                    <button
                      type="button"
                      onClick={() =>
                        onPatch(item.id, Math.max(1, item.quantity - 1))
                      }
                      disabled={item.quantity <= 1}
                      aria-label={`Decrease ${item.product.name} quantity`}
                      className="flex h-8 w-8 items-center justify-center text-[#17633a] disabled:opacity-40"
                    >
                      <MinusIcon />
                    </button>
                    <span className="w-8 text-center text-xs font-black text-[#243229]">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPatch(item.id, item.quantity + 1)}
                      disabled={item.quantity >= item.availableQuantity}
                      aria-label={`Increase ${item.product.name} quantity`}
                      className="flex h-8 w-8 items-center justify-center text-[#17633a] disabled:opacity-40"
                    >
                      <PlusIcon />
                    </button>
                  </div>

                  <div className="text-right">
                    <div className="text-[15px] font-black text-[#17633a]">
                      R{Number(item.lineTotal).toFixed(2)}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#7b867d]">
                      {item.product.unit}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </section>

          {/* Delivery address — mirrors the checkout "Deliver to" card. */}
          <section className="rounded-2xl border border-[#dce2d9] bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                <MapPinIcon className="h-3.5 w-3.5" />
                Deliver to
              </h2>
              <Link
                href="/addresses"
                className="text-[11px] font-black text-[#17633a] hover:underline"
              >
                {defaultAddress ? "Change" : "Add address"}
              </Link>
            </div>

            {defaultAddress ? (
              <div className="mt-2">
                <div className="text-[13px] font-black text-[#17251b]">
                  {defaultAddress.label}
                  {defaultAddress.isDefault ? (
                    <span className="ml-2 text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-[#69756c]">
                  {defaultAddress.recipientName} — {defaultAddress.addressLine1}
                  {defaultAddress.addressLine2
                    ? `, ${defaultAddress.addressLine2}`
                    : ""}
                  , {defaultAddress.city}
                  {defaultAddress.province ? `, ${defaultAddress.province}` : ""}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-dashed border-[#cbd5ca] p-3 text-[11px] leading-4 text-[#69756c]">
                No delivery address yet.{" "}
                <Link href="/addresses" className="font-black text-[#17633a]">
                  Add one
                </Link>{" "}
                to place an order.
              </div>
            )}
          </section>

          {/* Real cart math only — no coupon/GST/discount lines (they don't
              exist in BonAgri's data model). */}
          <section className="rounded-2xl border border-[#dce2d9] bg-white p-4">
            <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
              Bill details
            </h2>

            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-[#69756c]">
                  Subtotal ({items.length}{" "}
                  {items.length === 1 ? "item" : "items"})
                </dt>
                <dd className="font-bold text-[#243229]">
                  R{total.toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-[#e3e8e0] pt-2.5 text-base">
                <dt className="font-black text-[#243229]">Total</dt>
                <dd className="font-black text-[#17633a]">
                  R{total.toFixed(2)}
                </dd>
              </div>
            </dl>

            {supplierCount > 1 ? (
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[#7b867d]">
                {supplierCount} orders will be placed — one per supplier
              </p>
            ) : null}
          </section>

          {/* Optional delivery instructions — carried into checkout notes. */}
          <section className="rounded-2xl border border-[#dce2d9] bg-white p-4">
            <label
              htmlFor="cart-notes"
              className="text-[13px] font-black text-[#243229]"
            >
              Delivery instructions{" "}
              <span className="font-medium text-[#7b867d]">(optional)</span>
            </label>
            <textarea
              id="cart-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Gate code, best delivery time, quality requirements..."
              className="mt-2 w-full resize-none rounded-xl border border-[#cfd8ce] bg-[#fbfcf9] px-3.5 py-2.5 text-sm outline-none focus:border-[#17633a]"
            />
          </section>

          {!allInStock ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              Some items are out of stock. Adjust quantities to continue.
            </div>
          ) : null}

          <button
            type="button"
            onClick={proceedToCheckout}
            disabled={!allInStock}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#17633a] px-4 py-3.5 text-sm font-black text-white transition hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proceed to payment
            <ChevronRightIcon />
          </button>
        </>
      )}
    </div>
  );
}
