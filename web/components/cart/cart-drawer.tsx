"use client";

// Desktop mini-cart drawer. Purely presentational: every value and mutation
// is fed by the buyer shell's existing cart state (loadCart / patchCartItem /
// removeCartItem), so the drawer, the header badge and the full cart page all
// read from one source of truth. It never fetches on its own, never invents
// fees or discounts, and reuses the same lineTotal sum the cart page and
// checkout use for its totals.

import { useEffect, useState } from "react";
import {
  BasketIcon,
  CloseIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
} from "../mobile/icons";
import type { CartScreenItem } from "../mobile/cart-screen";

const EXIT_MS = 300;
// Frame callbacks are throttled to a standstill in hidden/occluded
// documents while timers keep running; the fallback guarantees the drawer
// still mounts, reveals and unmounts (so the scroll lock can never stick).
const FRAME_FALLBACK_MS = 64;

/** Run `fn` on the next animation frame, or after the fallback delay if
 *  frames are being throttled — whichever comes first. Returns a cancel. */
function afterFrame(fn: () => void): () => void {
  let done = false;
  let timer = 0;

  const run = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    fn();
  };

  const frame = requestAnimationFrame(run);
  timer = window.setTimeout(run, FRAME_FALLBACK_MS);

  return () => {
    done = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

type CartDrawerProps = {
  open: boolean;
  items: CartScreenItem[];
  error: string;
  /** True until the first cart fetch settles (skeleton while fetching). */
  loading: boolean;
  /** True while a cart mutation is in flight (duplicate-action guard). */
  busy: boolean;
  onPatch: (itemId: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
  onClose: () => void;
  onViewCart: () => void;
  onCheckout: () => void;
};

export default function CartDrawer({
  open,
  items,
  error,
  loading,
  busy,
  onPatch,
  onRemove,
  onClose,
  onViewCart,
  onCheckout,
}: CartDrawerProps) {
  // Two-phase mount so the exit transition has time to play: `mounted` keeps
  // the drawer in the DOM (and the scroll lock held) until the slide-out
  // finishes, while `shown` flips a frame later to trigger the slide.
  // Both updates happen inside frame callbacks, never in the effect body.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // Entrance: mount on the next frame, then reveal one frame after that so
  // the panel has a starting position (translate-x-full) to animate from.
  useEffect(() => {
    if (!open) return;

    let cancelReveal: (() => void) | undefined;
    const cancelMount = afterFrame(() => {
      setMounted(true);
      cancelReveal = afterFrame(() => setShown(true));
    });

    return () => {
      cancelMount();
      cancelReveal?.();
    };
  }, [open]);

  // Exit: slide out, then unmount once the transition has had time to finish.
  useEffect(() => {
    if (open || !mounted) return;

    let unmountTimer = 0;
    const cancelReveal = afterFrame(() => {
      setShown(false);
      unmountTimer = window.setTimeout(() => setMounted(false), EXIT_MS);
    });

    return () => {
      cancelReveal();
      window.clearTimeout(unmountTimer);
    };
  }, [open, mounted]);

  // Body scroll lock (position is preserved by locking `overflow`, so the
  // page resumes exactly where the buyer left off) + Escape-to-close. Same
  // convention as filter-sheet and sign-in-sheet.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  // Shrinking the window below `lg` turns the layout into the phone shell,
  // where this drawer has no business being — close it instead of letting
  // desktop chrome leak into mobile.
  useEffect(() => {
    if (!open) return;

    const mobile = window.matchMedia("(max-width: 1023px)");

    function handleViewportChange() {
      if (mobile.matches) onClose();
    }

    mobile.addEventListener("change", handleViewportChange);

    return () => {
      mobile.removeEventListener("change", handleViewportChange);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const count = items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = items.reduce(
    (total, item) => total + Number(item.lineTotal),
    0,
  );
  const supplierCount = new Set(
    items.map((item) => item.product.supplierName),
  ).size;
  const allInStock = items.every((item) => item.inStock);
  const empty = !loading && items.length === 0;
  const checkoutDisabled = loading || busy || !allInStock;

  return (
    <div
      className={`fixed inset-0 z-[110] flex justify-end transition-opacity duration-300 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Shopping cart"
      onClick={onClose}
    >
      {/* Backdrop dims the page behind the drawer. */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      <div
        className={`relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl transition-transform duration-300 ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header ------------------------------------------------------- */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="text-sm font-black text-ink">Your Cart</div>
            <div className="mt-0.5 text-xs text-ink-muted">
              {count} {count === 1 ? "item" : "items"} · R
              {subtotal.toFixed(2)}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-xl bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-bright">
            {error}
          </div>
        ) : null}

        {/* Items — independent scroll region --------------------------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && items.length === 0 ? (
            <div className="space-y-4" aria-label="Loading cart">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-2xl bg-surface-raised"
                />
              ))}
            </div>
          ) : empty ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised text-ink-faint">
                <BasketIcon className="h-7 w-7" />
              </div>
              <div className="mt-4 text-sm font-black text-ink">
                Your cart is empty
              </div>
              <p className="mt-1.5 text-xs leading-5 text-ink-muted">
                Browse the marketplace and add produce to your cart.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 rounded-xl bg-brand px-5 py-3 text-xs font-black text-brand-ink transition hover:opacity-90"
              >
                Continue shopping
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-line bg-surface p-3.5"
                >
                  <div className="flex items-start gap-3">
                    {/* Letter tile: cart items carry no image field, so this
                        mirrors the full cart page's row header. */}
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-lg font-black text-ink-muted">
                      {item.product.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-black leading-snug text-ink">
                        {item.product.name}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-ink-muted">
                        {item.product.supplierName} · R
                        {Number(item.product.price)}/{item.product.unit}
                      </div>

                      {!item.inStock ? (
                        <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-danger-bright">
                          Only {item.availableQuantity} left — reduce quantity
                          to check out
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      disabled={busy}
                      aria-label={`Remove ${item.product.name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-danger-soft hover:text-danger-bright disabled:opacity-40"
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center rounded-full border border-line bg-surface">
                      <button
                        type="button"
                        onClick={() =>
                          onPatch(item.id, Math.max(1, item.quantity - 1))
                        }
                        disabled={busy || item.quantity <= 1}
                        aria-label={`Decrease ${item.product.name} quantity`}
                        className="flex h-8 w-8 items-center justify-center text-success-bright disabled:opacity-40"
                      >
                        <MinusIcon />
                      </button>
                      <span className="w-8 text-center text-xs font-black text-ink">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPatch(item.id, item.quantity + 1)}
                        disabled={busy || item.quantity >= item.availableQuantity}
                        aria-label={`Increase ${item.product.name} quantity`}
                        className="flex h-8 w-8 items-center justify-center text-success-bright disabled:opacity-40"
                      >
                        <PlusIcon />
                      </button>
                    </div>

                    <div className="text-right">
                      <div className="text-[15px] font-black text-success-bright">
                        R{Number(item.lineTotal).toFixed(2)}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                        {item.product.unit}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {/* Summary + actions — pinned while the items scroll above them. */}
        <div className="border-t border-line bg-surface px-5 py-4">
          {error || !allInStock ? (
            <div className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-bright">
              {error ||
                "Some items are out of stock. Adjust quantities to continue."}
            </div>
          ) : null}

          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">
                Subtotal ({items.length} {items.length === 1 ? "item" : "items"}
                )
              </dt>
              <dd className="font-bold text-ink">R{subtotal.toFixed(2)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2 text-base">
              <dt className="font-black text-ink">Total</dt>
              <dd className="font-black text-success-bright">
                R{subtotal.toFixed(2)}
              </dd>
            </div>
          </dl>

          {supplierCount > 1 ? (
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              {supplierCount} orders will be placed — one per supplier
            </p>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-line px-4 py-3 text-xs font-black text-ink transition hover:bg-surface-raised"
            >
              Continue shopping
            </button>
            <button
              type="button"
              onClick={onViewCart}
              className="flex-1 rounded-xl border border-line px-4 py-3 text-xs font-black text-ink transition hover:bg-surface-raised"
            >
              View full cart
            </button>
          </div>

          <button
            type="button"
            onClick={onCheckout}
            disabled={checkoutDisabled}
            className="mt-2 flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3.5 text-sm font-black text-brand-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Proceed to checkout
          </button>
        </div>
      </div>
    </div>
  );
}
