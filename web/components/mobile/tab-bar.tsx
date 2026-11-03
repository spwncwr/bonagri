"use client";

import type { ComponentType } from "react";
import { BasketIcon, HomeIcon, SearchIcon, UserIcon } from "./icons";

export type MobileView = "home" | "explore" | "cart" | "profile";

type TabBarProps = {
  view: MobileView;
  cartCount: number;
  onNavigate: (view: MobileView) => void;
};

const TABS: Array<{
  key: MobileView;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "explore", label: "Explore", Icon: SearchIcon },
  { key: "cart", label: "Cart", Icon: BasketIcon },
  { key: "profile", label: "Profile", Icon: UserIcon },
];

export default function TabBar({ view, cartCount, onNavigate }: TabBarProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dfe3d9] bg-white/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, label, Icon }) => {
          const active = view === key;
          const badge = key === "cart" ? cartCount : 0;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-black uppercase tracking-wide transition ${
                active ? "text-[#17633a]" : "text-[#8a948b]"
              }`}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" />
                {badge > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#17633a] px-1 text-[9px] font-black not-italic text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
