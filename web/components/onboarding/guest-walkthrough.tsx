"use client";

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "bonagri.guestWalkthrough.v1";

const GOLD = "#d8a521";
/* Resolves through the theme tokens so dark mode keeps the copy readable. */
const THEME_INK = "var(--theme-primary-text)";

type Slide = {
  key: string;
  title: string;
  body: string;
  cta: string;
  art: () => ReactNode;
};

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function LogoLockup() {
  return (
    // Crop the tagline out of the full reversed lockup: the lockup is 2400x886,
    // the mark + wordmark occupy y 0-606 and x 180-2065.
    <span className="relative block h-10 w-[124px] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand lockup */}
      <img
        src="/brand/bonagri-logo-reversed.png"
        alt="BonAgri"
        className="absolute top-0 max-w-none"
        style={{ width: "127.3%", left: "-9.55%" }}
      />
    </span>
  );
}

function FloatingChip({
  children,
  dot,
  className = "",
}: {
  children: React.ReactNode;
  dot?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[#26352b] shadow-[0_10px_24px_rgba(3,26,13,0.22)] ${className}`}
    >
      {dot ? (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : null}
      {children}
    </span>
  );
}

function Pin({
  tone = "gold",
  className = "",
  width = 34,
}: {
  tone?: "gold" | "green";
  className?: string;
  width?: number;
}) {
  return (
    <svg
      viewBox="0 0 40 52"
      width={width}
      height={(width * 52) / 40}
      className={`drop-shadow-[0_6px_8px_rgba(10,42,24,0.28)] ${className}`}
      aria-hidden="true"
    >
      <path
        d="M20 1C9.5 1 1 9.2 1 19.3c0 12.6 13.5 25.9 19 30.7 5.5-4.8 19-18.1 19-30.7C39 9.2 30.5 1 20 1Z"
        fill={tone === "gold" ? GOLD : "#17633a"}
      />
      <circle cx="20" cy="19" r="7.4" fill="#ffffff" />
    </svg>
  );
}

function LeafGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M12 36c0-12 9-21 21-21 0 12-9 21-21 21Z"
        fill="#8cb56a"
      />
      <path
        d="M31 13c5-1 9-4 11-9-6 0-10 3-11 9Z"
        fill={GOLD}
      />
      <path
        d="M12 38c3-11 10-18 19-21"
        stroke="#2f6b45"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function WheatGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M32 58V17"
        stroke="#c3a02c"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <g fill="#d8ab2d">
        <ellipse cx="25" cy="24" rx="5" ry="8.5" transform="rotate(-36 25 24)" />
        <ellipse cx="39" cy="24" rx="5" ry="8.5" transform="rotate(36 39 24)" />
        <ellipse cx="24" cy="34" rx="5" ry="8.5" transform="rotate(-36 24 34)" />
        <ellipse cx="40" cy="34" rx="5" ry="8.5" transform="rotate(36 40 34)" />
        <ellipse cx="24" cy="44" rx="5" ry="8.5" transform="rotate(-36 24 44)" />
        <ellipse cx="40" cy="44" rx="5" ry="8.5" transform="rotate(36 40 44)" />
        <ellipse cx="32" cy="14" rx="4.5" ry="8" />
      </g>
    </svg>
  );
}

function CheckMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function PlusGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 4v16M4 12h16"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 1 — Discover local supply                                            */
/* -------------------------------------------------------------------------- */

function DiscoverArt() {
  return (
    <div className="relative w-full">
      <FloatingChip dot={GOLD} className="absolute -top-3 left-0 z-20">
        Maize
      </FloatingChip>
      <FloatingChip dot="#17633a" className="absolute -top-1 right-0 z-20">
        Fertiliser
      </FloatingChip>

      <div className="rounded-[26px] bg-white p-2 shadow-[0_28px_60px_rgba(3,26,13,0.42)]">
        <div className="relative aspect-[1.32] overflow-hidden rounded-[20px] bg-[#e4eee0]">
          {/* roads */}
          <div className="absolute inset-y-0 left-[31%] w-[5.5%] bg-white" />
          <div className="absolute inset-y-0 left-[67%] w-[5.5%] bg-white" />
          <div className="absolute inset-x-0 top-[34%] h-[6%] bg-white" />
          <div className="absolute inset-x-0 top-[72%] h-[6%] bg-white" />

          {/* plots */}
          <div className="absolute left-[4%] top-[6%] h-[22%] w-[21%] rounded-[9px] bg-[#d3e4cd]" />
          <div className="absolute left-[42%] top-[6%] h-[22%] w-[20%] rounded-[9px] bg-[#dcead7]" />
          <div className="absolute left-[78%] top-[6%] h-[22%] w-[17%] rounded-[9px] bg-[#d3e4cd]" />
          <div className="absolute left-[4%] top-[46%] h-[20%] w-[21%] rounded-[9px] bg-[#dcead7]" />
          <div className="absolute left-[42%] top-[46%] h-[20%] w-[20%] rounded-[9px] bg-[#d3e4cd]" />
          <div className="absolute left-[78%] top-[46%] h-[20%] w-[17%] rounded-[9px] bg-[#dcead7]" />
          <div className="absolute left-[4%] top-[84%] h-[24%] w-[21%] rounded-[9px] bg-[#d3e4cd]" />
          <div className="absolute left-[42%] top-[84%] h-[24%] w-[20%] rounded-[9px] bg-[#dcead7]" />
          <div className="absolute left-[78%] top-[84%] h-[24%] w-[17%] rounded-[9px] bg-[#d3e4cd]" />

          {/* pins */}
          <Pin
            tone="green"
            width={30}
            className="absolute left-[13%] top-[7%]"
          />
          <Pin
            tone="green"
            width={30}
            className="absolute right-[10%] top-[4%]"
          />
          <span className="absolute left-[37%] top-[37%] h-[54px] w-[54px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-[#d8a521]/30" />
          <Pin width={42} className="absolute left-[37%] top-[30%]" />
          <Pin width={30} className="absolute left-[20%] top-[52%]" />
        </div>
      </div>

      <div className="relative z-20 -mt-[14%] mx-[3%] flex items-center gap-2 rounded-2xl bg-white p-2.5 shadow-[0_18px_45px_rgba(3,26,13,0.35)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f1e6]">
          <LeafGlyph className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[13px] font-black tracking-tight" style={{ color: THEME_INK }}>
              Green Valley
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#e6f1e4] px-1.5 py-0.5 text-[7.5px] font-black text-[#17633a]">
              <CheckMark className="h-2 w-2" />
              Verified
            </span>
          </div>
          <div className="mt-0.5 truncate text-[9px] font-semibold text-[#7b857c]">
            Maize · Tomatoes · 2.4 km
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 2 — Order with confidence                                            */
/* -------------------------------------------------------------------------- */

function StatusIcon({ tone }: { tone: "done" | "current" | "todo" }) {
  if (tone === "done") {
    return (
      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#17633a]">
        <CheckMark className="h-3.5 w-3.5 text-white" />
      </span>
    );
  }

  if (tone === "current") {
    return (
      <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[3px] border-[#d8a521] bg-white">
        <span className="h-2.5 w-2.5 rounded-full bg-[#d8a521]" />
      </span>
    );
  }

  return (
    <span className="z-10 h-7 w-7 shrink-0 rounded-full border-[3px] border-[#cdd7cb] bg-white" />
  );
}

function StatusRow({
  tone,
  title,
  sub,
  line,
}: {
  tone: "done" | "current" | "todo";
  title: string;
  sub: string;
  line?: boolean;
}) {
  return (
    <div className="relative flex gap-2.5 pb-3.5 last:pb-0">
      {line ? (
        <span
          className={`absolute left-[13px] top-[26px] h-[calc(100%-26px)] w-[2px] ${
            tone === "done" ? "bg-[#17633a]" : "bg-[#d7ded5]"
          }`}
        />
      ) : null}
      <StatusIcon tone={tone} />
      <div className="min-w-0 pt-0.5 text-left">
        <div
          className={`text-[12px] font-black leading-tight ${
            tone === "todo" ? "text-ink-disabled" : "text-ink"
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 text-[9px] font-medium text-ink-faint">
          {sub}
        </div>
      </div>
    </div>
  );
}

function ShieldGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 84 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="walkthrough-shield-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9bb3f" />
          <stop offset="1" stopColor="#c19118" />
        </linearGradient>
      </defs>
      <path
        d="M42 3 78 16v31c0 24-15 42-36 50C21 89 6 71 6 47V16L42 3Z"
        fill="url(#walkthrough-shield-gold)"
        stroke="#f3d67c"
        strokeWidth="1.5"
      />
      <path
        d="m26 49 11 11 22-22"
        stroke="#ffffff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function OrderArt() {
  return (
    <div className="relative mx-auto w-full">
      <div className="rounded-[28px] bg-white px-5 pb-5 pt-5 text-left shadow-[0_28px_60px_rgba(3,26,13,0.42)]">
        <h3
          className="text-[17px] font-black tracking-tight"
          style={{ color: THEME_INK }}
        >
          Order status
        </h3>
        <div className="mt-4">
          <StatusRow
            tone="done"
            title="Order confirmed"
            sub="Supplier accepted"
            line
          />
          <StatusRow
            tone="done"
            title="Being prepared"
            sub="Stock reserved for you"
            line
          />
          <StatusRow
            tone="current"
            title="Out for delivery"
            sub="On the way to you"
            line
          />
          <StatusRow
            tone="todo"
            title="Delivered"
            sub="Arrives at your door"
          />
        </div>
      </div>

      <ShieldGlyph className="absolute -right-3 -top-6 h-[66px] w-[55px] drop-shadow-[0_18px_25px_rgba(3,26,13,0.35)]" />

      <FloatingChip dot="#17633a" className="absolute -bottom-4 left-0 z-20">
        Secure checkout
      </FloatingChip>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Slide 3 — Sell or move goods                                               */
/* -------------------------------------------------------------------------- */

function TruckArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 190" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="walkthrough-cab-gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e3b230" />
          <stop offset="1" stopColor="#c79418" />
        </linearGradient>
      </defs>

      {/* cargo box */}
      <rect x="18" y="36" width="196" height="106" rx="8" fill="#ffffff" />
      <rect x="18" y="120" width="196" height="22" fill="#e9f0e4" />
      <image
        href="/brand/bonagri-mark.png"
        x="90"
        y="48"
        width="60"
        height="60"
        preserveAspectRatio="xMidYMid meet"
      />

      {/* cab */}
      <path
        d="M214 56h48c10 0 19 6 23 15l22 46c2 5 3 10 3 15v10h-96V56Z"
        fill="url(#walkthrough-cab-gold)"
      />
      <path
        d="M252 66h12c6 0 11 3 14 8l13 21h-39V66Z"
        fill="#e7f0e3"
      />
      <rect x="294" y="126" width="18" height="8" rx="4" fill="#f6e4a8" />

      {/* wheels */}
      <circle cx="82" cy="150" r="21" fill="#0c3c21" />
      <circle cx="82" cy="150" r="7.5" fill="#f3f7ef" />
      <circle cx="143" cy="150" r="21" fill="#0c3c21" />
      <circle cx="143" cy="150" r="7.5" fill="#f3f7ef" />
      <circle cx="268" cy="150" r="21" fill="#0c3c21" />
      <circle cx="268" cy="150" r="7.5" fill="#f3f7ef" />

      {/* destination pin */}
      <path
        d="M330 106c-9 0-16 7-16 16 0 10 11 20 16 25 5-5 16-15 16-25 0-9-7-16-16-16Z"
        fill="url(#walkthrough-cab-gold)"
      />
      <circle cx="330" cy="122" r="5.5" fill="#ffffff" />

      {/* road */}
      <line
        x1="14"
        y1="179"
        x2="346"
        y2="179"
        stroke="#8fa596"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="18 14"
        opacity="0.55"
      />
    </svg>
  );
}

function SellArt() {
  return (
    <div className="relative w-full">
      <div className="relative z-10 w-[76%] rounded-[22px] bg-white p-3.5 shadow-[0_24px_50px_rgba(3,26,13,0.4)]">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#e8f0e3]">
            <WheatGlyph className="h-11 w-11" />
          </div>
          <div className="min-w-0 text-left">
            <div
              className="truncate text-[15px] font-black tracking-tight"
              style={{ color: THEME_INK }}
            >
              Maize · 120 kg
            </div>
            <div className="mt-0.5 text-[10px] font-medium text-[#7b857c]">
              Ready to sell
            </div>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#e8f1e6] px-2 py-0.5 text-[9px] font-black text-[#17633a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2c7a4b]" />
              In stock
            </span>
          </div>
        </div>
      </div>

      <span className="absolute -top-7 right-2 z-20 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[linear-gradient(145deg,#e6b531,#c9951a)] shadow-[0_16px_30px_rgba(3,26,13,0.4)]">
        <PlusGlyph className="h-8 w-8 text-white" />
      </span>

      <FloatingChip dot="#17633a" className="absolute right-0 top-[90px] z-20">
        New order
      </FloatingChip>

      <TruckArt className="relative z-0 mt-5 w-full" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

const SLIDES: Slide[] = [
  {
    key: "discover",
    title: "Discover local supply",
    body: "Browse fresh produce, farm inputs and goods from verified suppliers near you.",
    cta: "Next",
    art: DiscoverArt,
  },
  {
    key: "order",
    title: "Order with confidence",
    body: "Follow every order from confirmation to delivery, with clear updates at each step.",
    cta: "Next",
    art: OrderArt,
  },
  {
    key: "sell",
    title: "Sell or move goods",
    body: "List your products, manage your stock and get orders from buyers nearby.",
    cta: "Get started",
    art: SellArt,
  },
];

export default function GuestWalkthrough() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Phones only, first visit only. Waits for the splash to finish so the two
  // screens read as one sequence instead of overlapping.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;

    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      // Storage can be unavailable (private mode) — show the walkthrough.
    }

    const timer = window.setTimeout(() => setOpen(true), 1900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function finish() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Nothing to persist; the walkthrough just reappears next visit.
    }
    setOpen(false);
    setStep(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (step === SLIDES.length - 1) {
      finish();
      return;
    }
    setStep((current) => current + 1);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="BonAgri walkthrough"
      className="fixed inset-0 z-[95] overflow-hidden bg-[#f7f5ed] lg:hidden"
    >
      <div
        className="flex h-full w-full transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${step * 100}%)` }}
      >
        {SLIDES.map((slide, index) => {
          const Art = slide.art;
          const active = index === step;

          return (
            <section
              key={slide.key}
              aria-hidden={!active}
              inert={!active}
              className="flex h-full w-full shrink-0 flex-col"
            >
              {/* Green hero */}
              <div className="relative h-[55%] min-h-[320px] max-h-[540px] shrink-0 overflow-hidden rounded-b-[2.75rem] bg-[#0d4225]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(135%_105%_at_12%_-10%,#2f6d47_0%,#175432_44%,#0a381c_100%)]" />
                <div className="pointer-events-none absolute left-1/2 top-[62%] h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.075),rgba(255,255,255,0.02)_58%,transparent_70%)]" />
                <div className="pointer-events-none absolute left-1/2 top-[62%] h-[24rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.055]" />
                <div className="pointer-events-none absolute left-[10%] top-[33%] h-2 w-2 rounded-full bg-[#e0b23a]" />
                <div className="pointer-events-none absolute right-[14%] top-[52%] h-1.5 w-1.5 rounded-full bg-[#b9c9bb]/70" />
                <div className="pointer-events-none absolute bottom-[16%] left-[15%] h-1.5 w-1.5 rounded-full bg-[#e0b23a]/80" />

                <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-[calc(1.1rem+env(safe-area-inset-top))]">
                  <LogoLockup />
                  <button
                    type="button"
                    onClick={finish}
                    className="text-sm font-semibold text-white/90 transition hover:text-white"
                  >
                    Skip
                  </button>
                </div>

                <div
                  className={`absolute inset-x-0 bottom-[5%] top-[16%] z-10 flex justify-center px-6 ${
                    slide.key === "sell" ? "items-end" : "items-center"
                  }`}
                >
                  <div
                    className={
                      slide.key === "sell"
                        ? "w-[82%] max-w-[330px]"
                        : "w-[72%] max-w-[310px]"
                    }
                  >
                    <Art />
                  </div>
                </div>
              </div>

              {/* Copy */}
              <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 text-center">
                <h2
                  id={`walkthrough-title-${slide.key}`}
                  className="max-w-[19.5rem] text-[clamp(1.9rem,8.4vw,2.3rem)] font-black leading-[1.1] tracking-[-0.03em]"
                  style={{ color: THEME_INK }}
                >
                  {slide.title}
                </h2>

                <p className="mt-3 max-w-[18.5rem] text-[clamp(0.82rem,3.6vw,0.95rem)] leading-6 text-[#6b7269] sm:leading-7">
                  {slide.body}
                </p>

                <div className="mt-auto flex items-center justify-center gap-2 pt-5">
                  {SLIDES.map((dot, dotIndex) => (
                    <button
                      key={dot.key}
                      type="button"
                      onClick={() => setStep(dotIndex)}
                      aria-label={`Go to step ${dotIndex + 1}: ${dot.title}`}
                      aria-current={dotIndex === step}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        dotIndex === step
                          ? "w-7 bg-[#d8a521]"
                          : "w-2 bg-[#c9d0c6] hover:bg-[#b4bfb0]"
                      }`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={next}
                  className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-full bg-[linear-gradient(90deg,#155c33,#0f4a28)] py-3.5 text-base font-black text-white shadow-[0_14px_30px_rgba(13,66,37,0.35)] transition active:scale-[0.99]"
                >
                  {slide.cta}
                  {index < SLIDES.length - 1 ? (
                    <ArrowGlyph className="h-[18px] w-[18px] text-[#e8bb3f]" />
                  ) : null}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
