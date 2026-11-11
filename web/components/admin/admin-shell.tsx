"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { BrandIcon } from "../brand/logo";
import {
  BasketIcon,
  BellIcon,
  BoxIcon,
  CameraIcon,
  ChevronRightIcon,
  HomeIcon,
  InfoIcon,
  ListIcon,
  LogoutIcon,
  MegaphoneIcon,
  SearchIcon,
  ShieldIcon,
  StarIcon,
  StoreIcon,
  TruckIcon,
  UserIcon,
  VerifiedIcon,
} from "../mobile/icons";
import { clearAuth, fetchCurrentUser, type AuthUser } from "../../lib/auth";
import { AppearanceSection } from "../theme/theme-switch";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: HomeIcon },
  { href: "/admin/users", label: "Users", icon: UserIcon },
  { href: "/admin/suppliers", label: "Suppliers", icon: StoreIcon },
  { href: "/admin/verification", label: "Verification", icon: VerifiedIcon },
  { href: "/admin/transporters", label: "Transporters", icon: TruckIcon },
  { href: "/admin/categories", label: "Categories", icon: BoxIcon },
  { href: "/admin/banners", label: "Banners", icon: CameraIcon },
  { href: "/admin/promotions", label: "Promotions", icon: StarIcon },
  { href: "/admin/notifications", label: "Broadcasts", icon: MegaphoneIcon },
  { href: "/admin/orders", label: "Orders", icon: BasketIcon },
  { href: "/admin/disputes", label: "Disputes", icon: ShieldIcon },
  { href: "/admin/applications", label: "Applications", icon: ListIcon },
];

// The header shows the busiest destinations as pills; the rail keeps all of them.
const PRIMARY_HREFS = ["/admin", "/admin/users", "/admin/orders", "/admin/promotions", "/admin/notifications"];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function IconButton({
  label,
  children,
  onClick,
  active,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
        active
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
          : "border-white/8 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((current) => {
      if (!cancelled) setUser(current);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Popovers are dismissed by the navigation handlers rather than an effect so
  // that a page change can never leave a stale panel open.
  function closePopovers() {
    setSearchOpen(false);
    setInfoOpen(false);
    setMenuOpen(false);
    setQuery("");
  }

  function signOut() {
    closePopovers();
    clearAuth();
    router.push("/login");
  }

  const results = query.trim()
    ? NAV.filter((item) =>
        item.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : NAV;

  return (
    <div className="admin-dark min-h-screen bg-[#0b0b12] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/6 bg-[#0b0b12]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 lg:px-8">
          <Link
            href="/admin"
            className="flex shrink-0 items-center gap-2.5 rounded-full border border-white/8 bg-white/5 px-3.5 py-2 transition hover:bg-white/10"
          >
            <BrandIcon size={26} className="rounded-lg" />
            <span className="text-sm font-black tracking-tight text-white">
              BonAgri
            </span>
            <span className="hidden rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300 sm:block">
              Admin
            </span>
          </Link>

          <nav className="hidden items-center gap-1.5 xl:flex">
            {NAV.filter((item) => PRIMARY_HREFS.includes(item.href)).map(
              (item) => {
                const active = isActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={closePopovers}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-white/10 text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              },
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <IconButton
                label="Search admin sections"
                active={searchOpen}
                onClick={() => {
                  setSearchOpen((open) => !open);
                  setInfoOpen(false);
                  setMenuOpen(false);
                }}
              >
                <SearchIcon className="h-4.5 w-4.5" />
              </IconButton>

              {searchOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setSearchOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[#15151f] p-2 shadow-2xl">
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Jump to a section..."
                      className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:bg-white/8"
                    />
                    <div className="mt-1.5 max-h-72 overflow-y-auto">
                      {results.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={closePopovers}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/8 hover:text-white"
                        >
                          <item.icon className="h-4 w-4 text-emerald-300" />
                          {item.label}
                          <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-slate-500" />
                        </Link>
                      ))}
                      {results.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-slate-500">
                          No section matches “{query.trim()}”.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <Link
              href="/admin/notifications"
              aria-label="Broadcasts"
              onClick={closePopovers}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                pathname.startsWith("/admin/notifications")
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : "border-white/8 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <BellIcon className="h-4.5 w-4.5" />
            </Link>

            <div className="relative hidden sm:block">
              <IconButton
                label="About this dashboard"
                active={infoOpen}
                onClick={() => {
                  setInfoOpen((open) => !open);
                  setSearchOpen(false);
                  setMenuOpen(false);
                }}
              >
                <InfoIcon className="h-4.5 w-4.5" />
              </IconButton>

              {infoOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setInfoOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[#15151f] p-4 text-xs leading-5 text-slate-400 shadow-2xl">
                    <p className="text-sm font-bold text-white">
                      BonAgri control room
                    </p>
                    <p className="mt-2">
                      Every screen reads live platform data — approve sellers,
                      verify suppliers, publish storefront promotions and move
                      orders through fulfilment.
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setSearchOpen(false);
                  setInfoOpen(false);
                }}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2.5 rounded-full border border-white/8 bg-white/5 py-1.5 pl-1.5 pr-3 transition hover:bg-white/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-xs font-black text-white">
                  {(user?.firstName ?? "A").slice(0, 1)}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-bold leading-tight text-white">
                    {user ? `${user.firstName} ${user.lastName}` : "Admin"}
                  </span>
                  <span className="block max-w-[140px] truncate text-[10px] leading-tight text-slate-400">
                    {user?.email ?? "Signing in..."}
                  </span>
                </span>
                <ChevronRightIcon className="h-3.5 w-3.5 rotate-90 text-slate-400" />
              </button>

              {menuOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[#15151f] p-2 shadow-2xl">
                    <Link
                      href="/"
                      onClick={closePopovers}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/8 hover:text-white"
                    >
                      Marketplace
                      <ArrowRightGlyph />
                    </Link>

                    {/* The console keeps the established dark palette; this
                        setting drives the rest of Bonagri. */}
                    <AppearanceSection className="m-2" />
                    <button
                      type="button"
                      onClick={signOut}
                      className="mt-0.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/10"
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

        {/* Narrow screens: the full section list becomes a scrollable pill row. */}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-3 xl:hidden">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closePopovers}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6 lg:px-8">
        <aside className="sticky top-28 hidden h-fit w-[60px] shrink-0 flex-col items-center gap-1.5 rounded-3xl border border-white/6 bg-[#12121a] p-2.5 lg:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onClick={closePopovers}
                title={item.label}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                  active
                    ? "bg-emerald-500/18 text-emerald-300"
                    : "text-slate-500 hover:bg-white/6 hover:text-slate-200"
                }`}
              >
                <item.icon className="h-5 w-5" />
              </Link>
            );
          })}

          <span className="my-1 h-px w-7 bg-white/8" />

          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-11 w-11 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
          >
            <LogoutIcon className="h-5 w-5" />
          </button>
        </aside>

        <main className="min-w-0 flex-1 pb-12">{children}</main>
      </div>
    </div>
  );
}

function ArrowRightGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
