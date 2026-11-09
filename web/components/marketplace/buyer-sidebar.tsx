"use client";

// Desktop-only buyer navigation pane (hidden below lg, where the phone shell's
// tab bar carries these destinations instead). Every entry maps to a route or
// view the buyer app already has — nothing here invents a new destination.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { getCategoryIcon } from "../mobile/category-icons";
import {
  BasketIcon,
  ChevronRightIcon,
  CompassIcon,
  HomeIcon,
  ListIcon,
  LogoutIcon,
  MapPinIcon,
  MegaphoneIcon,
  SettingsIcon,
  UserIcon,
} from "../mobile/icons";
import { AppearanceSection } from "../theme/theme-switch";
import type { AuthUser } from "../../lib/auth";

export type BuyerView = "home" | "explore" | "cart" | "profile" | "orders";

type BuyerSidebarProps = {
  view: BuyerView;
  activeCategory: string;
  categories: string[];
  cartCount: number;
  user: AuthUser | null;
  onNavigate: (view: BuyerView) => void;
  onPickCategory: (name: string) => void;
  onSignOut: () => void;
};

type Item = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  view?: BuyerView;
  href?: string;
  badge?: number;
};

const BROWSE: Item[] = [
  { key: "home", label: "Home", icon: HomeIcon, view: "home" },
  { key: "explore", label: "All products", icon: CompassIcon, view: "explore" },
  { key: "cart", label: "Cart", icon: BasketIcon, view: "cart" },
];

const ACCOUNT: Item[] = [
  { key: "orders", label: "My orders", icon: ListIcon, view: "orders" },
  { key: "requests", label: "Product requests", icon: MegaphoneIcon, href: "/requests" },
  { key: "addresses", label: "Delivery addresses", icon: MapPinIcon, href: "/addresses" },
  { key: "profile", label: "Profile", icon: UserIcon, view: "profile" },
  { key: "settings", label: "Settings", icon: SettingsIcon, href: "/settings" },
];

function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h2 className="px-3 pb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-ink-faint">
        {title}
      </h2>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

export default function BuyerSidebar({
  view,
  activeCategory,
  categories,
  cartCount,
  user,
  onNavigate,
  onPickCategory,
  onSignOut,
}: BuyerSidebarProps) {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);

  function itemClass(active: boolean) {
    return [
      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-bold transition",
      active
        ? "bg-success-soft text-success-bright"
        : "text-ink-soft hover:bg-surface-raised hover:text-ink",
    ].join(" ");
  }

  function renderItem(item: Item) {
    const active = item.view
      ? view === item.view
      : Boolean(item.href) && pathname === item.href;

    const inner = (
      <>
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        {item.badge && item.badge > 0 ? (
          <span className="shrink-0 rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-black text-success-bright">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </>
    );

    return (
      <li key={item.key}>
        {item.href ? (
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={itemClass(active)}
          >
            {inner}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate(item.view as BuyerView)}
            aria-current={active ? "page" : undefined}
            className={itemClass(active)}
          >
            {inner}
          </button>
        )}
      </li>
    );
  }

  const browse = BROWSE.map((item) =>
    item.key === "cart" ? { ...item, badge: cartCount } : item,
  );

  // Posting product requests is a buyer feature — other roles never see it.
  const account = ACCOUNT.filter(
    (item) => item.key !== "requests" || user?.role === "BUYER",
  );

  return (
    <aside
      aria-label="Buyer navigation"
      className="sticky top-[128px] hidden h-fit max-h-[calc(100vh-9rem)] w-[250px] shrink-0 flex-col overflow-y-auto rounded-3xl border border-line bg-surface p-3 lg:flex"
    >
      <nav aria-label="Buyer sections">
        <Group title="Browse">{browse.map(renderItem)}</Group>

        <Group title="Categories">
        <li>
          <button
            type="button"
            onClick={() => onPickCategory("All")}
            className={itemClass(activeCategory === "All")}
          >
            <BasketIcon className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              All categories
            </span>
          </button>
        </li>

        {categories.map((name) => {
          const Icon = getCategoryIcon(name);

          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => onPickCategory(name)}
                className={itemClass(activeCategory === name)}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {name}
                </span>
              </button>
            </li>
          );
        })}
      </Group>

        <Group title="Your account">{account.map(renderItem)}</Group>
      </nav>

      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setAccountOpen((open) => !open)}
          aria-expanded={accountOpen}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-raised p-2.5 text-left transition hover:bg-surface"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-black text-brand-ink">
            {(user?.firstName ?? "B").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-black text-ink">
              {user ? `${user.firstName} ${user.lastName}` : "Buyer account"}
            </span>
            <span className="block truncate text-[10px] text-ink-muted">
              {user?.email ?? "Signed in"}
            </span>
          </span>
          <ChevronRightIcon
            className={`h-4 w-4 shrink-0 text-ink-faint transition ${
              accountOpen ? "-rotate-90" : "rotate-90"
            }`}
          />
        </button>

        {accountOpen ? (
          <div className="mt-2">
            <AppearanceSection />

            <button
              type="button"
              onClick={onSignOut}
              className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold text-danger-bright transition hover:bg-danger-soft"
            >
              <LogoutIcon className="h-4 w-4" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
