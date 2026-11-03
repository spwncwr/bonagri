"use client";

import { Baloo_2 } from "next/font/google";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandIcon } from "../brand/logo";
import { ThemeToggle } from "../theme/theme-switch";
import { ArrowLeftIcon } from "../mobile/icons";

/* Rounded display face shared by the auth screens (login + register). */
export const authDisplay = Baloo_2({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-auth-display",
  display: "swap",
});

export const DISPLAY = "[font-family:var(--font-auth-display)]";

/* Mint pill input with a floating, dotted-underline label (design signature). */
export function PillField({
  id,
  type,
  autoComplete,
  label,
  value,
  onChange,
  inputRef,
  required = true,
  minLength,
}: {
  id: string;
  type: string;
  autoComplete: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  required?: boolean;
  minLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  const floating = focused || value.length > 0;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder=" "
        className={`w-full rounded-full bg-[#cbe8d8] text-[#14532d] outline-none transition-all duration-200 placeholder-transparent focus:bg-[#d8efe2] focus:ring-2 focus:ring-[#2d9d5e]/30 ${
          floating
            ? "px-6 pb-2.5 pt-5 text-left text-sm"
            : "px-6 py-4 text-center text-base"
        }`}
      />
      <label
        htmlFor={id}
        className={`pointer-events-none absolute flex items-end text-[#17633a]/80 transition-all duration-200 ${
          floating
            ? "left-6 top-1.5 justify-start text-[11px]"
            : "inset-x-0 top-1/2 -translate-y-1/2 justify-center text-base"
        }`}
      >
        <span className="border-b border-dotted border-[#17633a]/45 pb-px">
          {label}
        </span>
      </label>
    </div>
  );
}

/*
 * Layered splash curves along the bottom edge (phones only) — the organic
 * corner waves from the reference mock, recoloured to the BonAgri greens.
 */
export function BottomSplash({ tone }: { tone: "green" | "mint" }) {
  const layers =
    tone === "green"
      ? ["bg-[#2f9e5f] opacity-40", "bg-[#3fae6f] opacity-55", "bg-[#7cc79b] opacity-45"]
      : ["bg-[#e6f4ec]", "bg-[#cbe8d8]", "bg-[#2d9d5e] opacity-15"];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-44 overflow-visible lg:hidden"
    >
      <div
        className={`absolute -bottom-56 -right-28 h-80 w-[135%] rounded-[50%] ${layers[0]}`}
      />
      <div
        className={`absolute -bottom-56 right-[-45%] h-80 w-[120%] rounded-[50%] ${layers[1]}`}
      />
      <div
        className={`absolute -bottom-56 right-[-14%] h-80 w-[80%] rounded-[50%] ${layers[2]}`}
      />
    </div>
  );
}

/*
 * Green welcome panel — left half on wide screens, screen A on phones.
 * Contains the organic blobs: desktop blob + white corner carve, and the
 * mobile-only lighter-green slant sweeping the bottom-left corner.
 */
export function WelcomePanel({
  headline,
  sublines,
  ctaLabel,
  onCta,
}: {
  headline: string;
  sublines: [string, string];
  ctaLabel: string;
  onCta: () => void;
}) {
  /* Phones only: the logo enters centred, then flies to the top-right corner. */
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="relative flex min-h-screen w-screen shrink-0 flex-col items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#0f4d2c_0%,#17633a_45%,#1d7a48_100%)] px-8 py-14 text-center lg:w-1/2">
      {/* Organic lighter-green blob + white corner carve (desktop). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[18%] top-[10%] hidden h-[125%] w-[82%] rotate-6 rounded-[46%] bg-[linear-gradient(160deg,#2d9d5e_0%,#1d7a48_65%,#17633a_100%)] opacity-80 lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 hidden h-72 w-72 rounded-full bg-white lg:block"
      />
      {/* Mobile: lighter-green slant sweeping the bottom-left corner. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-44 -left-52 h-[36rem] w-[36rem] rounded-full bg-[linear-gradient(150deg,#3aa76b_0%,#2d9d5e_60%,#1d7a48_100%)] opacity-75 lg:hidden"
      />
      {/* Mobile: splash curves along the bottom edge. */}
      <BottomSplash tone="green" />

      {/* Logo badge — centred on entry, parked top-right on phones; in-flow on desktop. */}
      <div
        className={`absolute left-1/2 top-1/2 z-20 flex flex-col items-center transition-all duration-[900ms] ease-out lg:static lg:translate-x-0 lg:translate-y-0 lg:scale-100 ${
          entered
            ? "translate-x-[calc(-50%_+_50vw_-_4rem)] translate-y-[calc(-50%_-_50vh_+_3.5rem)] scale-[0.68]"
            : "-translate-x-1/2 -translate-y-1/2"
        }`}
      >
        <BrandIcon
          size={64}
          className="rounded-full shadow-lg shadow-black/25 ring-2 ring-white/80"
        />
        <p className={`${DISPLAY} mt-3 text-lg font-bold text-white`}>
          BonAgri
        </p>
      </div>

      <div
        className={`relative z-10 flex w-full max-w-sm flex-col items-center transition-opacity duration-700 lg:opacity-100 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      >
        <h1
          className={`${DISPLAY} text-3xl font-bold text-white lg:mt-12 lg:text-4xl`}
        >
          {headline}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/85">
          {sublines[0]}
          <br />
          {sublines[1]}
        </p>

        <button
          type="button"
          onClick={onCta}
          className="mt-10 rounded-full border border-white/70 px-16 py-3 text-xs font-semibold tracking-[0.3em] text-white transition hover:bg-white/10"
        >
          {ctaLabel}
        </button>

        <p className="mt-10 text-[11px] text-white/60">
          <Link
            href="/"
            className="inline-flex items-center gap-1 underline underline-offset-2 transition hover:text-white"
          >
            <ArrowLeftIcon className="h-3 w-3" strokeWidth={2.4} />
            BACK TO MARKETPLACE
          </Link>
        </p>
      </div>
    </section>
  );
}

/*
 * White form panel — right half on wide screens, screen B on phones.
 * Desktop carries the green corner accents; phones get the curved green
 * header with the logo and a back arrow.
 */
export function FormPanel({
  onBack,
  children,
}: {
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="relative flex min-h-screen w-screen shrink-0 items-start justify-center overflow-hidden bg-white px-6 pb-24 pt-0 lg:w-1/2 lg:items-center lg:px-6 lg:pb-12 lg:pt-12">
      {/* Green corner accents (desktop only). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-44 -top-48 hidden h-[24rem] w-[24rem] rounded-full bg-[linear-gradient(135deg,#2d9d5e_0%,#17633a_100%)] lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -left-24 hidden h-64 w-64 rounded-full bg-[linear-gradient(135deg,#2d9d5e_0%,#17633a_100%)] lg:block"
      />

      {/* Mobile: soft mint splash along the bottom edge. */}
      <BottomSplash tone="mint" />

      {/* Mobile-only slanted green canopy anchored to the top-left corner. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-56 overflow-hidden lg:hidden">
        <div className="absolute -left-[8%] -top-12 h-52 w-[122%] rotate-[-5deg] rounded-bl-[2.5rem] rounded-br-[7rem] bg-[linear-gradient(115deg,#0f4d2c_0%,#17633a_55%,#2d9d5e_100%)]" />
        {/* Deeper accent blob for organic depth. */}
        <div className="absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[#0c3f24]/25" />
      </div>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to welcome"
        className="absolute left-4 top-4 z-20 rounded-full p-2 text-white/90 transition hover:text-white lg:hidden"
      >
        <ArrowLeftIcon className="h-5 w-5" strokeWidth={2.2} />
      </button>
      <div className="absolute right-4 top-4 z-20 flex flex-col items-center lg:hidden">
        <BrandIcon
          size={48}
          className="rounded-full shadow-lg shadow-black/25 ring-2 ring-white/80"
        />
        <p className={`${DISPLAY} mt-1.5 text-sm font-bold text-white`}>
          BonAgri
        </p>
      </div>

      <div className="relative z-10 w-full max-w-sm pt-[12rem] lg:pt-0">
        {children}
      </div>
    </section>
  );
}

/*
 * Moon/sun pill anchored to the bottom-right corner of the auth screens.
 * Rendered outside the sliding panel track on purpose: the track is
 * transformed, and a transformed ancestor would capture position: fixed.
 */
export function AuthThemeToggle() {
  return (
    <div className="fixed bottom-5 right-5 z-40">
      <ThemeToggle />
    </div>
  );
}
