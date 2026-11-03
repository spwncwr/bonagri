"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BrandIcon } from "../brand/logo";
import { AppearanceSection } from "../theme/theme-switch";
import {
  BasketIcon,
  BellIcon,
  ChevronRightIcon,
  LogoutIcon,
  MapPinIcon,
} from "./icons";
import type { AuthUser } from "../../lib/auth";

type AppHeaderProps = {
  cartCount: number;
  notificationsOpen: boolean;
  /** Rendered inside the bell dropdown (the existing notifications panel). */
  notificationsPanel: ReactNode;
  onCart: () => void;
  onToggleNotifications: () => void;
  /** The shared live-search bar, composed by the shell. */
  searchSlot?: ReactNode;
  showSearch?: boolean;
  // Desktop chrome. The phone layout ignores all of these, so omitting them
  // leaves the mobile header exactly as it was.
  user?: AuthUser | null;
  onSignOut?: () => void;
  onSubmitSearch?: () => void;
  deliverTo?: string | null;
};

export default function AppHeader({
  cartCount,
  notificationsOpen,
  notificationsPanel,
  onCart,
  onToggleNotifications,
  searchSlot,
  showSearch = true,
  user = null,
  onSignOut,
  onSubmitSearch,
  deliverTo = null,
}: AppHeaderProps) {
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header
      className={`sticky top-0 z-40 bg-transparent ${
        showSearch ? "pb-1" : "pb-3"
      } lg:border-b lg:border-line lg:bg-surface/95 lg:pb-0 lg:backdrop-blur`}
    >
      {notificationsOpen ? (
        <button
          type="button"
          aria-label="Close notifications"
          onClick={onToggleNotifications}
          className="fixed inset-0 z-30 cursor-default bg-black/20"
        />
      ) : null}

      <div className="mx-auto max-w-2xl px-4 pt-3 lg:flex lg:max-w-[1600px] lg:items-center lg:gap-6 lg:px-6 lg:pt-4">
        {/* lg:contents lets the search bar slot in between the brand and the
            actions without changing the phone row. */}
        <div className="flex items-center justify-between lg:contents">
          <div className="flex items-center gap-2.5 lg:order-1 lg:shrink-0">
            <BrandIcon size={36} className="rounded-xl lg:h-10 lg:w-10" />
            <div>
              <div className="text-lg font-black leading-none tracking-tight lg:text-xl">
                BonAgri
              </div>
              <div className="mt-1 text-[8px] font-bold tracking-[0.22em] text-[#778178]">
                AGRICULTURAL MARKETPLACE
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:order-3 lg:ml-auto lg:shrink-0 lg:gap-2.5">
            {deliverTo !== null ? (
              <Link
                href="/addresses"
                className="hidden items-center gap-2 rounded-xl border border-[#d5ddd3] bg-white px-3 py-2 text-left transition hover:border-[#17633a] lg:flex"
              >
                <MapPinIcon className="h-4 w-4 text-[#17633a]" />
                <span className="leading-tight">
                  <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-[#8a948b]">
                    Deliver to
                  </span>
                  <span className="block max-w-[120px] truncate text-[11px] font-black text-[#243229]">
                    {deliverTo}
                  </span>
                </span>
              </Link>
            ) : null}

            <button
              type="button"
              onClick={onToggleNotifications}
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
              className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition ${
                notificationsOpen
                  ? "border-[#17633a] bg-[#eaf3ec] text-[#17633a]"
                  : "border-[#d5ddd3] bg-white text-[#344238]"
              }`}
            >
              <BellIcon className="h-[18px] w-[18px]" />
            </button>

            <button
              type="button"
              onClick={onCart}
              aria-label={`Open cart, ${cartCount} items`}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#d5ddd3] bg-white text-[#344238] transition"
            >
              <BasketIcon className="h-[18px] w-[18px]" />
              {cartCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#17633a] px-1 text-[9px] font-black text-white">
                  {cartCount > 9 ? "9+" : cartCount}
                </span>
              ) : null}
            </button>

            <div className="relative hidden lg:block">
              <button
                type="button"
                onClick={() => setAccountOpen((open) => !open)}
                aria-label="Account menu"
                aria-expanded={accountOpen}
                className="flex items-center gap-2 rounded-full border border-[#d5ddd3] bg-white py-1.5 pl-1.5 pr-3 transition hover:border-[#17633a]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#17633a] text-xs font-black text-white">
                  {(user?.firstName ?? "B").slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 text-left leading-tight">
                  <span className="block max-w-[140px] truncate text-[11px] font-black text-[#243229]">
                    {user ? `${user.firstName} ${user.lastName}` : "Buyer"}
                  </span>
                  <span className="block max-w-[140px] truncate text-[10px] text-[#8a948b]">
                    {user?.email ?? "Signed in"}
                  </span>
                </span>
                <ChevronRightIcon
                  className={`h-3.5 w-3.5 text-[#8a948b] transition ${
                    accountOpen ? "-rotate-90" : "rotate-90"
                  }`}
                />
              </button>

              {accountOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAccountOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-xl">
                    <AppearanceSection className="m-1" />
                    {onSignOut ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          onSignOut();
                        }}
                        className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger-bright transition hover:bg-danger-soft"
                      >
                        <LogoutIcon className="h-4 w-4" />
                        Sign out
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {showSearch && searchSlot ? (
          <div className="mt-3 lg:order-2 lg:mt-0 lg:flex lg:min-w-0 lg:flex-1 lg:items-center lg:gap-2">
            {searchSlot}
            {onSubmitSearch ? (
              <button
                type="button"
                onClick={onSubmitSearch}
                className="hidden shrink-0 rounded-full bg-[#17633a] px-6 py-2.5 text-sm font-black text-white transition hover:bg-[#0f4d2b] lg:block"
              >
                Search
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Desktop utility strip — the marketplace's own region line, plus the
          supplier application route the guest header already offers. */}
      <div className="mt-3 hidden border-t border-line lg:block">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-6 px-6 py-2">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-ink-faint">
            Agricultural trade • Limpopo • South Africa
          </span>
          <Link
            href="/apply"
            className="text-[11px] font-black uppercase tracking-wide text-ink-muted transition hover:text-success-bright"
          >
            Sell on BonAgri
          </Link>
        </div>
      </div>

      {notificationsOpen ? (
        <div className="absolute right-3 top-[calc(100%+8px)] z-50 max-h-[70vh] w-[min(92vw,24rem)] overflow-y-auto rounded-2xl bg-white p-3 shadow-2xl lg:right-6 lg:w-96">
          {notificationsPanel}
        </div>
      ) : null}
    </header>
  );
}
