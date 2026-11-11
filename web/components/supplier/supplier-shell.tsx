"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { BrandIcon } from "../brand/logo";
import {
  BasketIcon,
  BellIcon,
  BoxIcon,
  ChevronRightIcon,
  CloseIcon,
  GlobeIcon,
  HelpIcon,
  HomeIcon,
  LogoutIcon,
  MegaphoneIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  SlidersIcon,
  TruckIcon,
  VerifiedIcon,
} from "../mobile/icons";
import {
  clearAuth,
  fetchCurrentUser,
  type AuthUser,
  type UserRole,
} from "../../lib/auth";
import { AppearanceSection } from "../theme/theme-switch";

type NavItem = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
};

// Every destination is its own screen — no anchor jumps, so each section
// keeps its own route (and its own back button) instead of one long scroll.
const NAV: NavItem[] = [
  { key: "desk", label: "Dashboard", icon: HomeIcon, href: "/supplier" },
  { key: "queue", label: "Order queue", icon: TruckIcon, href: "/supplier/orders" },
  { key: "listings", label: "Listings", icon: BoxIcon, href: "/supplier/products" },
  { key: "inventory", label: "Inventory", icon: BasketIcon, href: "/supplier/inventory" },
  { key: "new", label: "New listing", icon: PlusIcon, href: "/supplier/products/new" },
  { key: "demand", label: "Demand board", icon: MegaphoneIcon, href: "/supplier/demand" },
  { key: "verify", label: "Verification", icon: VerifiedIcon, href: "/supplier/verification" },
  { key: "disputes", label: "Disputes", icon: ShieldIcon, href: "/supplier/disputes" },
  { key: "market", label: "Marketplace", icon: GlobeIcon, href: "/" },
];

// The phone bar can only carry four destinations plus an overflow sheet.
const MOBILE_KEYS = ["desk", "listings", "inventory", "demand"];

// Destinations that only exist in the overflow sheet: the desk settings
// screen has no room in the bar, and the rail already carries its own
// help/settings affordance at the bottom.
const SHEET_ITEMS: NavItem[] = [
  { key: "settings", label: "Settings", icon: SettingsIcon, href: "/supplier/settings" },
];

function roleLabel(role: UserRole | null): string {
  if (role === "AGRO_DEALER") return "Agro dealer";
  if (role === "SUPPLIER") return "Supplier";
  return "Supply desk";
}

export default function SupplierShell({
  vendorRole,
  attention = 0,
  children,
}: {
  vendorRole: UserRole | null;
  attention?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((current) => {
      if (!cancelled) setUser(current);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function closePopovers() {
    setMenuOpen(false);
    setMoreOpen(false);
  }

  function signOut() {
    closePopovers();
    clearAuth();
    router.replace("/login");
  }

  function renderItem(item: NavItem, variant: "rail" | "bar" | "sheet") {
    // The desk root matches only itself; every other destination also lights
    // up for its child routes (Listings while editing a listing, for example).
    const active =
      pathname === item.href ||
      (item.href !== "/supplier" && pathname.startsWith(`${item.href}/`));
    const className =
      variant === "rail"
        ? `flex h-11 w-11 items-center justify-center rounded-2xl transition ${
            active
              ? "bg-ink text-page"
              : "text-ink-faint hover:bg-surface-raised hover:text-ink"
          }`
        : variant === "bar"
          ? `flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold transition ${
              active ? "text-success-bright" : "text-ink-muted"
            }`
          : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-surface-raised";

    const inner = (
      <>
        <item.icon className="h-5 w-5" />
        {variant === "rail" ? null : item.label}
        {variant === "sheet" ? (
          <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-ink-faint" />
        ) : null}
      </>
    );

    return (
      <Link
        key={item.key}
        href={item.href}
        onClick={closePopovers}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        title={item.label}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-page text-ink">
      <div className="mx-auto flex max-w-[1700px]">
        {/* Full-height rail pinned to the left edge, as in the reference. */}
        <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col items-center justify-between border-r border-line bg-surface py-4 lg:flex">
          <div className="flex flex-col items-center gap-2">
            {NAV.map((item) => renderItem(item, "rail"))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <Link
              href="/supplier/settings"
              aria-label="Help and settings"
              title="Help and settings"
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-faint transition hover:bg-surface-raised hover:text-ink"
            >
              <HelpIcon className="h-5 w-5" />
            </Link>

            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-faint transition hover:bg-danger-soft hover:text-danger-bright"
            >
              <LogoutIcon className="h-5 w-5" />
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
              <Link
                href="/supplier"
                onClick={closePopovers}
                aria-label="BonAgri supply desk"
                className="flex shrink-0 items-center gap-2.5"
              >
                <BrandIcon size={30} className="rounded-xl" />
                <h1 className="text-xl font-black tracking-tight text-ink">
                  {/* roleLabel() falls back to "Supply desk" for a role that
                      has not loaded yet, so only append " desk" once the role
                      is known — otherwise the heading reads "Supply desk
                      desk" during the first paint. */}
                  {vendorRole ? `${roleLabel(vendorRole)} desk` : "Supply desk"}
                </h1>
              </Link>

              <Link
                href="/supplier/orders"
                onClick={closePopovers}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-bold text-ink-soft transition hover:bg-surface"
              >
                {vendorRole === "AGRO_DEALER" ? "Tools and equipment" : "All products"}
                <ChevronRightIcon className="h-3.5 w-3.5 rotate-90 text-ink-faint" />
              </Link>

              <div className="ml-auto flex items-center gap-2">
                <Link
                  href="/supplier/orders"
                  aria-label="Filter orders"
                  className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface-raised text-ink-muted transition hover:text-ink sm:flex"
                >
                  <SlidersIcon className="h-4.5 w-4.5" />
                </Link>

                <Link
                  href="/supplier/settings"
                  aria-label="Settings"
                  className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted transition hover:text-ink sm:flex"
                >
                  <SettingsIcon className="h-4.5 w-4.5" />
                </Link>

                <Link
                  href="/supplier#notifications"
                  aria-label={`Notifications${
                    attention > 0 ? `, ${attention} needing attention` : ""
                  }`}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted transition hover:text-ink"
                >
                  <BellIcon className="h-4.5 w-4.5" />
                  {attention > 0 ? (
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
                  ) : null}
                </Link>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((open) => !open)}
                    aria-label="Account menu"
                    aria-expanded={menuOpen}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-black text-brand-ink transition hover:opacity-90"
                  >
                    {(user?.firstName ?? "S").slice(0, 1).toUpperCase()}
                  </button>

                  {menuOpen ? (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-surface p-2 shadow-xl">
                        <p className="px-3 pb-1 pt-2 text-xs font-bold text-ink">
                          {user
                            ? `${user.firstName} ${user.lastName}`
                            : roleLabel(vendorRole)}
                        </p>
                        <p className="max-w-full truncate px-3 pb-2 text-[10px] text-ink-muted">
                          {user?.email ?? "Signing in..."}
                        </p>
                        <AppearanceSection className="m-1" />
                        <button
                          type="button"
                          onClick={signOut}
                          className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger-bright transition hover:bg-danger-soft"
                        >
                          <LogoutIcon className="h-4 w-4" />
                          Sign out
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <main className="px-4 py-5 pb-24 lg:px-6 lg:pb-8">{children}</main>
        </div>
      </div>

      {/* Phones and small tablets: the rail becomes a thumb-reachable bar and
          the remaining destinations fold into a sheet. */}
      <nav
        aria-label="Supply desk sections"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {NAV.filter((item) => MOBILE_KEYS.includes(item.key)).map((item) =>
          renderItem(item, "bar"),
        )}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More sections"
          className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold text-ink-muted"
        >
          <span className="flex h-5 items-center justify-center gap-0.5">
            <span className="h-1 w-1 rounded-full bg-current" />
            <span className="h-1 w-1 rounded-full bg-current" />
            <span className="h-1 w-1 rounded-full bg-current" />
          </span>
          More
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-[var(--theme-overlay)] p-3 sm:items-center sm:justify-center lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More supply desk sections"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-line bg-surface p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-sm font-black text-ink">Supply desk</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-0.5">
              {[...NAV, ...SHEET_ITEMS].filter(
                (item) => !MOBILE_KEYS.includes(item.key),
              ).map((item) => renderItem(item, "sheet"))}
            </div>

            <AppearanceSection className="mt-3" />

            <button
              type="button"
              onClick={signOut}
              className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger-bright transition hover:bg-danger-soft"
            >
              <LogoutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
