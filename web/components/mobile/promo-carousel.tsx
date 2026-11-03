"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon } from "./icons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// Fallback slides when no dynamic banners are created by admin
const FALLBACK_SLIDES = [
  {
    id: "fallback-1",
    eyebrow: "FOR SUPPLIERS",
    title: "Sell on BonAgri",
    subtitle: "List your produce and reach buyers across Limpopo.",
    cta: "Apply now",
    href: "/apply",
    tone: "from-[#17633a] to-[#0c3f23]",
    imageUrl: null,
  },
  {
    id: "fallback-2",
    eyebrow: "FOR BUYERS",
    title: "Post a product request",
    subtitle: "Tell suppliers what you need and let them respond.",
    cta: "Post a request",
    href: "/requests",
    tone: "from-[#1f7a45] to-[#113f27]",
    imageUrl: null,
  },
  {
    id: "fallback-3",
    eyebrow: "YOUR ORDERS",
    title: "Track every order",
    subtitle: "Live status from confirmation through to delivery.",
    cta: "My orders",
    href: "/orders",
    tone: "from-[#166b3c] to-[#0e3a22]",
    imageUrl: null,
  },
];

type CarouselSlide = {
  id: string;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  cta: string;
  href: string;
  tone: string;
  imageUrl: string | null;
};

export default function PromoCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [slides, setSlides] = useState<CarouselSlide[]>(FALLBACK_SLIDES);

  useEffect(() => {
    let cancelled = false;

    async function loadBanners() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/banners`);
        if (!res.ok) return;
        const data = (await res.json()) as Array<{
          id: string;
          title: string;
          subtitle: string | null;
          eyebrow: string | null;
          ctaText: string | null;
          ctaLink: string | null;
          tone: string | null;
          imageUrl: string | null;
        }>;

        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setSlides(
            data.map((b) => ({
              id: b.id,
              eyebrow: b.eyebrow,
              title: b.title,
              subtitle: b.subtitle,
              cta: b.ctaText || "Learn more",
              href: b.ctaLink || "/explore",
              tone: b.tone || "from-[#17633a] to-[#0c3f23]",
              imageUrl: b.imageUrl,
            })),
          );
        }
      } catch {
        // Keeps fallback slides on network error
      }
    }

    void loadBanners();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;

    setIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  function goToSlide(nextIndex: number) {
    const track = trackRef.current;
    if (!track) return;

    track.scrollTo({ left: nextIndex * track.clientWidth, behavior: "smooth" });
    setIndex(nextIndex);
  }

  // Auto-play sliding every 5 seconds when there are multiple slides
  useEffect(() => {
    if (slides.length <= 1) return;

    const timer = setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % slides.length;
        const track = trackRef.current;
        if (track && track.clientWidth > 0) {
          track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
        }
        return next;
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <section aria-label="Highlights">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide) => (
          <Link
            key={slide.id}
            href={slide.href}
            className={`relative mr-3 flex w-[calc(100%-0.75rem)] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br ${slide.tone} p-5 text-white shadow-sm last:mr-0`}
          >
            {slide.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/30" />
              </>
            ) : null}

            <div className="relative z-10">
              {slide.eyebrow ? (
                <div className="text-[9px] font-black tracking-[0.2em] text-white/70">
                  {slide.eyebrow}
                </div>
              ) : null}
              <div className="mt-2 text-xl font-black leading-tight tracking-tight">
                {slide.title}
              </div>
              {slide.subtitle ? (
                <p className="mt-1.5 text-xs leading-5 text-white/80">
                  {slide.subtitle}
                </p>
              ) : null}
            </div>

            <div className="relative z-10 mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-white/15 px-3.5 py-2 text-[11px] font-black backdrop-blur-sm">
              {slide.cta}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-2.5 flex justify-center gap-1.5">
        {slides.map((slide, slideIndex) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => goToSlide(slideIndex)}
            aria-label={`Go to slide ${slideIndex + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              slideIndex === index
                ? "w-5 bg-[#17633a]"
                : "w-1.5 bg-[#c9d2c7]"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
