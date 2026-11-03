"use client";

import { MoonIcon, SunIcon } from "../mobile/icons";
import { useTheme } from "./theme-provider";
import type { ThemeMode } from "../../lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: "light", label: "Light mode", Icon: SunIcon },
  { mode: "dark", label: "Dark mode", Icon: MoonIcon },
];

/**
 * The one theme control every role uses. Kept deliberately small so it can sit
 * inside a settings row, a card or the admin shell without extra markup.
 */
export function ThemeSwitch({
  className = "",
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const { mode, setMode } = useTheme();
  const compact = size === "sm";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-raised p-1 ${className}`}
    >
      {OPTIONS.map(({ mode: option, label, Icon }) => {
        const active = mode === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(option)}
            className={`flex items-center justify-center gap-1.5 rounded-full font-bold transition ${
              compact
                ? "px-3 py-1.5 text-[11px]"
                : "px-4 py-2 text-xs"
            } ${
              active
                ? "bg-brand text-brand-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Icon-only pill for corners and headers: sun and moon, no labels, with the
 * active side lifted onto a thumb. Same store, same behaviour as ThemeSwitch.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-lg shadow-black/15 ${className}`}
    >
      {OPTIONS.map(({ mode: option, label, Icon }) => {
        const active = mode === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setMode(option)}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              active
                ? "bg-surface-raised text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
          </button>
        );
      })}
    </div>
  );
}

/** Standalone Appearance card for screens that have no settings row markup. */
export function AppearanceSection({
  className = "",
  title = "Appearance",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-4 ${className}`}
    >
      <h2 className="text-sm font-black text-ink">{title}</h2>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-bold text-ink">Theme</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">
            Choose how Bonagri looks on your device.
          </p>
        </div>
        <ThemeSwitch size="md" />
      </div>
    </section>
  );
}
