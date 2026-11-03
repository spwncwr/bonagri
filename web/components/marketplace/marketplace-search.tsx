"use client";

import { useEffect, useRef, useState } from "react";
import { buildImageUrl } from "../../lib/media";
import {
  ArrowRightIcon,
  CloseIcon,
  SearchIcon,
  SlidersIcon,
} from "../mobile/icons";

const RECENT_KEY = "bonagri.recentSearches.v1";
const MAX_RECENT = 5;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 6;

export type SearchResultProduct = {
  id: string;
  name: string;
  price: string;
  unit: string;
  category: string;
  supplier: string;
  location: string;
  imageUrl: string | null;
  availableQuantity: number;
  tone: string;
  visual: string;
};

export type SearchCategoryOption = { name: string; slug: string };

type MarketplaceSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  /** Enter / "See all results": the parent commits the full results view. */
  onSubmit: (query: string) => void;
  onSelectProduct: (productId: string) => void;
  onOpenFilters: () => void;
  onResetFilters: () => void;
  activeFilterCount: number;
  /** Live matches for the current query (the parent debounces the fetch). */
  results: SearchResultProduct[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  categories: SearchCategoryOption[];
  onPickCategory: (name: string) => void;
  size?: "compact" | "large";
  placeholder?: string;
  className?: string;
};

function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function writeRecentSearches(terms: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(terms));
  } catch {
    // Private mode / blocked storage: history just will not persist.
  }
}

function ProductThumb({ product }: { product: SearchResultProduct }) {
  const imageUrl = buildImageUrl(product.imageUrl, 96);

  return (
    <div
      className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ${product.tone}`}
    >
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black text-[#304635]/70">
        {product.visual}
      </span>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- fixed-size thumbnail, no optimizer needed
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

export default function MarketplaceSearch({
  query,
  onQueryChange,
  onSubmit,
  onSelectProduct,
  onOpenFilters,
  onResetFilters,
  activeFilterCount,
  results,
  loading,
  error,
  onRetry,
  categories,
  onPickCategory,
  size = "compact",
  placeholder = "Search products, brands, or categories...",
  className = "",
}: MarketplaceSearchProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readRecentSearches(),
  );

  // Outside click closes the suggestion panel without stealing focus back.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function rememberTerm(value: string) {
    const term = value.trim();
    if (!term) return;

    setRecent((current) => {
      const next = [
        term,
        ...current.filter(
          (item) => item.toLowerCase() !== term.toLowerCase(),
        ),
      ].slice(0, MAX_RECENT);
      writeRecentSearches(next);
      return next;
    });
  }

  function clearRecent() {
    setRecent([]);
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
  }

  function submitSearch() {
    rememberTerm(query);
    setOpen(false);
    onSubmit(query.trim());
  }

  function selectProduct(productId: string) {
    rememberTerm(query);
    setOpen(false);
    onSelectProduct(productId);
  }

  function pickCategory(name: string) {
    setOpen(false);
    onPickCategory(name);
  }

  function clearQuery() {
    onQueryChange("");
    setOpen(true);
    inputRef.current?.focus();
  }

  const trimmed = query.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const showResults = trimmed.length >= MIN_QUERY_LENGTH;
  const suggestions = showResults ? results.slice(0, MAX_SUGGESTIONS) : [];
  const matchingCategories = showResults
    ? categories
        .filter((category) =>
          category.name.toLowerCase().includes(trimmed.toLowerCase()),
        )
        .slice(0, 3)
    : [];
  const popularCategories = categories.slice(0, 8);
  const filterLabel = activeFilterCount
    ? `Filters, ${activeFilterCount} active`
    : "Filters";
  const large = size === "large";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
        className={
          large
            ? "rounded-2xl border border-[#cdd6ca] bg-white p-2 shadow-xl shadow-[#203b29]/10"
            : "flex items-center gap-2"
        }
      >
        <div
          className={
            large
              ? "flex items-stretch gap-2"
              : "flex flex-1 items-center gap-2 rounded-full border border-[#d5ddd3] bg-white px-4 py-2.5 shadow-sm transition focus-within:border-[#17633a] focus-within:ring-2 focus-within:ring-[#17633a]/15"
          }
        >
          <div
            className={
              large
                ? "flex flex-1 items-center px-4 focus-within:text-[#17633a]"
                : "flex min-w-0 flex-1 items-center gap-2"
            }
          >
            <SearchIcon
              className={
                large
                  ? "mr-3 h-5 w-5 shrink-0 text-[#17633a]"
                  : "h-4 w-4 shrink-0 text-[#8a948b]"
              }
            />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  event.currentTarget.blur();
                }
              }}
              placeholder={placeholder}
              role="combobox"
              aria-autocomplete="list"
              aria-label="Search products"
              aria-expanded={open}
              aria-controls="marketplace-search-panel"
              autoComplete="off"
              className={
                large
                  ? "w-full bg-transparent py-3.5 text-sm text-[#17251b] outline-none placeholder:text-[#89928a]"
                  : "w-full min-w-0 bg-transparent text-sm text-[#17251b] outline-none placeholder:text-[#98a199]"
              }
            />
            {query ? (
              <button
                type="button"
                onClick={clearQuery}
                aria-label="Clear search"
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6f7b71] transition hover:bg-[#eef2ec] hover:text-[#243229]"
              >
                <CloseIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenFilters();
            }}
            aria-label={filterLabel}
            aria-haspopup="dialog"
            className={
              large
                ? "relative flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#17633a] px-5 py-3.5 text-sm font-black text-white transition hover:bg-[#0f4d2b]"
                : "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#17633a] text-white transition hover:bg-[#0f4d2b]"
            }
          >
            <SlidersIcon className={large ? "h-4 w-4" : "h-[18px] w-[18px]"} />
            {large ? <span>Filters</span> : null}
            {activeFilterCount ? (
              <span
                className={`absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f0c24a] px-1 text-[9px] font-black text-[#17251b] shadow ${
                  large ? "right-1 top-1" : "-right-1 -top-1"
                }`}
              >
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>
      </form>

      {open ? (
        <div
          id="marketplace-search-panel"
          role="region"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[80] max-h-[min(70vh,26rem)] overflow-y-auto rounded-2xl border border-[#dce2d9] bg-white shadow-2xl shadow-[#203b29]/20"
        >
          {trimmed.length === 0 ? (
            <div className="space-y-4 p-4">
              {recent.length > 0 ? (
                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
                      Recent searches
                    </h3>
                    <button
                      type="button"
                      onClick={clearRecent}
                      className="text-[10px] font-bold text-[#17633a] hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recent.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => {
                          onQueryChange(term);
                          inputRef.current?.focus();
                        }}
                        className="flex items-center gap-1.5 rounded-full border border-[#dbe2d8] bg-[#f6f8f4] px-3 py-1.5 text-[11px] font-semibold text-[#334138] hover:border-[#17633a]"
                      >
                        <SearchIcon className="h-3 w-3 text-[#8a948b]" />
                        {term}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {popularCategories.length > 0 ? (
                <section>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
                    Popular categories
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {popularCategories.map((category) => (
                      <button
                        key={category.slug}
                        type="button"
                        onClick={() => pickCategory(category.name)}
                        className="rounded-full border border-[#dbe2d8] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#334138] hover:border-[#17633a] hover:text-[#17633a]"
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <p className="px-1 text-xs leading-5 text-[#69756c]">
                  Search for produce, tools or suppliers to see live results.
                </p>
              )}
            </div>
          ) : tooShort ? (
            <div className="p-4 text-xs leading-5 text-[#69756c]">
              Keep typing — enter at least {MIN_QUERY_LENGTH} characters to see
              product suggestions.
            </div>
          ) : error ? (
            <div className="space-y-3 p-4">
              <p className="text-xs font-semibold text-red-700">
                Search is unavailable right now: {error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-[#17633a] px-4 py-2 text-[11px] font-black text-white hover:bg-[#0f4d2b]"
              >
                Try again
              </button>
            </div>
          ) : loading && suggestions.length === 0 ? (
            <div className="space-y-2 p-3" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex animate-pulse items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-[#e8ede5]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-[#e8ede5]" />
                    <div className="h-2.5 w-1/2 rounded bg-[#eef2ec]" />
                  </div>
                </div>
              ))}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="p-4">
              <p className="text-sm font-black text-[#243229]">
                No products found
              </p>
              <p className="mt-1 text-xs leading-5 text-[#69756c]">
                Check the spelling or try a different keyword. You can also
                browse a category below.
              </p>
              {matchingCategories.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {matchingCategories.map((category) => (
                    <button
                      key={category.slug}
                      type="button"
                      onClick={() => pickCategory(category.name)}
                      className="rounded-full border border-[#dbe2d8] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#17633a] hover:border-[#17633a]"
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearQuery}
                  className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                >
                  Clear search
                </button>
                {activeFilterCount ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onResetFilters();
                    }}
                    className="rounded-lg border border-[#d5ddd3] px-3 py-2 text-[11px] font-bold text-[#334138] hover:bg-[#f4f7f2]"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              {matchingCategories.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 border-b border-[#edf0ea] px-3 py-2">
                  {matchingCategories.map((category) => (
                    <button
                      key={category.slug}
                      type="button"
                      onClick={() => pickCategory(category.name)}
                      className="rounded-full bg-[#eef3ea] px-2.5 py-1 text-[10px] font-bold text-[#17633a] hover:bg-[#e2ebdd]"
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="divide-y divide-[#f0f3ee]">
                {suggestions.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectProduct(product.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[#f5f8f3]"
                  >
                    <ProductThumb product={product} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-black text-[#17251b]">
                        {product.name}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-semibold text-[#7a847c]">
                        {product.category} · {product.supplier}
                      </div>
                      <div
                        className={`mt-0.5 text-[10px] font-bold ${
                          product.availableQuantity > 0
                            ? "text-[#17633a]"
                            : "text-red-600"
                        }`}
                      >
                        {product.availableQuantity > 0
                          ? "In stock"
                          : "Out of stock"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-black text-[#17251b]">
                        {product.price}
                      </div>
                      <div className="text-[10px] text-[#8a948b]">
                        {product.unit}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={submitSearch}
                className="flex w-full items-center justify-between gap-2 border-t border-[#edf0ea] bg-[#f7f9f5] px-4 py-3 text-[11px] font-black text-[#17633a] transition hover:bg-[#eef3ea]"
              >
                <span>
                  See all {results.length}{" "}
                  {results.length === 1 ? "result" : "results"} for “{trimmed}”
                </span>
                <ArrowRightIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
