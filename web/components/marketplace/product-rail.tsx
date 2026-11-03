"use client";

import { useEffect, useRef, useState } from "react";
import { buildImageUrl } from "../../lib/media";
import { mapApiProduct, type ApiProduct, type Product } from "../../lib/catalog";
import RatingStarsGlyphs from "../mobile/rating-stars";
import { ProductRailSkeleton } from "./skeletons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// A sideways-scrollable marketplace section (Alibaba/Amazon-style rail).
// Loads its own slice of the catalog; renders nothing when the API fails or
// the category has no products, so it can never break the page around it.
export default function ProductRail({
  title,
  sort,
  onOpen,
}: {
  title: string;
  sort: "trending" | "newest";
  onOpen: (product: Product) => void;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/api/products?sort=${sort}&take=12`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Rail request failed: ${response.status}`);
        const data: ApiProduct[] = await response.json();
        if (!cancelled) setProducts(data.map(mapApiProduct));
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sort]);

  if (products !== null && products.length === 0) return null;

  const scrollByPage = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * scroller.clientWidth * 0.85,
      behavior: "smooth",
    });
  };

  return (
    <section aria-label={title} className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-black tracking-tight text-[#17251b]">
          {title}
        </h3>

        <div className="hidden gap-1.5 sm:flex">
          <button
            type="button"
            aria-label={`Scroll ${title} back`}
            onClick={() => scrollByPage(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d5ddd3] bg-white text-[#334138] transition hover:bg-[#f4f7f2]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={`Scroll ${title} forward`}
            onClick={() => scrollByPage(1)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d5ddd3] bg-white text-[#334138] transition hover:bg-[#f4f7f2]"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {products === null ? (
        <ProductRailSkeleton />
      ) : (
        <div
          ref={scrollerRef}
          className="no-scrollbar -mx-1 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1"
        >
          {products.map((product) => {
            const imageUrl = buildImageUrl(product.imageUrl, 640);

            return (
              <button
                key={product.id}
                type="button"
                onClick={() => onOpen(product)}
                aria-label={`View ${product.name}`}
                className="w-36 shrink-0 snap-start text-left transition active:scale-[0.98] sm:w-44"
              >
                <div
                  className={`relative aspect-square overflow-hidden rounded-2xl ${product.tone}`}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-black tracking-tight text-[#304635]/70">
                      {product.visual}
                    </span>
                  </div>

                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={product.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                </div>

                <h4 className="mt-2 truncate text-xs font-black leading-tight text-[#17251b]">
                  {product.name}
                </h4>

                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-black text-[#17633a]">
                    {product.price}
                    <span className="ml-1 text-[10px] font-bold text-[#7b867d]">
                      {product.unit}
                    </span>
                  </span>

                  {product.ratingCount > 0 && product.ratingAverage !== null ? (
                    <span className="flex shrink-0 items-center gap-1 text-[10px]">
                      <RatingStarsGlyphs
                        value={product.ratingAverage}
                        className="h-2.5 w-2.5"
                      />
                      <span className="font-black text-[#27382b]">
                        {product.ratingAverage.toFixed(1)}
                      </span>
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
