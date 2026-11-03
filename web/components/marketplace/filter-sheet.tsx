"use client";

import { useEffect, useState } from "react";
import { CloseIcon, SlidersIcon } from "../mobile/icons";

export type SortOption = "relevance" | "price_asc" | "price_desc" | "newest";

export type MarketplaceFilters = {
  category: string;
  minPrice: string;
  maxPrice: string;
  province: string;
  city: string;
  supplierId: string;
  sort: SortOption;
};

export type ProductFacets = {
  suppliers: Array<{
    id: string;
    businessName: string;
    city: string | null;
    province: string | null;
  }>;
  provinces: string[];
  cities: string[];
  priceRange: { min: number | null; max: number | null };
};

export const DEFAULT_FILTERS: MarketplaceFilters = {
  category: "All",
  minPrice: "",
  maxPrice: "",
  province: "",
  city: "",
  supplierId: "",
  sort: "relevance",
};

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "newest", label: "Newest first" },
];

function formatRand(value: number) {
  return `R${value.toLocaleString("en-ZA", { maximumFractionDigits: 2 })}`;
}

export function countActiveFilters(filters: MarketplaceFilters) {
  let count = 0;
  if (filters.category && filters.category !== "All") count += 1;
  if (filters.minPrice.trim() !== "" || filters.maxPrice.trim() !== "") count += 1;
  if (filters.province || filters.city) count += 1;
  if (filters.supplierId) count += 1;
  return count;
}

function parsePrice(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateFilters(filters: MarketplaceFilters): string {
  for (const [value, label] of [
    [filters.minPrice, "Minimum"],
    [filters.maxPrice, "Maximum"],
  ] as const) {
    if (value.trim() === "") continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return `${label} price must be a number.`;
    if (parsed < 0) return `${label} price cannot be negative.`;
  }

  const min = parsePrice(filters.minPrice);
  const max = parsePrice(filters.maxPrice);

  if (min !== null && max !== null && min > max) {
    return "Minimum price cannot be greater than maximum price.";
  }

  return "";
}

type FilterChipsProps = {
  filters: MarketplaceFilters;
  facets: ProductFacets | null;
  onChange: (next: MarketplaceFilters) => void;
};

// One removable chip per applied filter group, so clearing one never touches
// the search query or the other filters.
export function FilterChips({ filters, facets, onChange }: FilterChipsProps) {
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];

  if (filters.category && filters.category !== "All") {
    chips.push({
      key: "category",
      label: filters.category,
      clear: () => onChange({ ...filters, category: "All" }),
    });
  }

  if (filters.minPrice.trim() !== "" || filters.maxPrice.trim() !== "") {
    const min = parsePrice(filters.minPrice);
    const max = parsePrice(filters.maxPrice);
    const label =
      min !== null && max !== null
        ? `${formatRand(min)}–${formatRand(max)}`
        : min !== null
          ? `From ${formatRand(min)}`
          : `Up to ${formatRand(max ?? 0)}`;
    chips.push({
      key: "price",
      label,
      clear: () => onChange({ ...filters, minPrice: "", maxPrice: "" }),
    });
  }

  if (filters.province || filters.city) {
    chips.push({
      key: "location",
      label: [filters.city, filters.province].filter(Boolean).join(", "),
      clear: () => onChange({ ...filters, province: "", city: "" }),
    });
  }

  if (filters.supplierId) {
    const supplier = facets?.suppliers.find(
      (item) => item.id === filters.supplierId,
    );
    chips.push({
      key: "supplier",
      label: supplier?.businessName ?? "Selected seller",
      clear: () => onChange({ ...filters, supplierId: "" }),
    });
  }

  if (filters.sort !== "relevance") {
    const option = SORT_OPTIONS.find((item) => item.value === filters.sort);
    chips.push({
      key: "sort",
      label: option?.label ?? filters.sort,
      clear: () => onChange({ ...filters, sort: "relevance" }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.clear}
          className="flex items-center gap-1.5 rounded-full border border-[#c9d6c4] bg-[#eef3ea] px-2.5 py-1 text-[10px] font-bold text-[#17633a] transition hover:border-[#17633a]"
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label}
          <CloseIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
        </button>
      ))}
    </div>
  );
}

type FilterSheetProps = {
  open: boolean;
  filters: MarketplaceFilters;
  facets: ProductFacets | null;
  categories: Array<{ name: string; slug: string }>;
  onApply: (next: MarketplaceFilters) => void;
  onClose: () => void;
};

export default function FilterSheet({
  open,
  filters,
  facets,
  categories,
  onApply,
  onClose,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<MarketplaceFilters>(filters);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const activeCount = countActiveFilters(draft);
  const province = draft.province;
  const cityOptions = facets
    ? Array.from(
        new Set(
          facets.suppliers
            .filter((supplier) => !province || supplier.province === province)
            .map((supplier) => supplier.city)
            .filter((city): city is string => Boolean(city)),
        ),
      ).sort((left, right) => left.localeCompare(right))
    : [];

  function update(patch: Partial<MarketplaceFilters>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      // A city from another province is meaningless once the province moves.
      if (
        patch.province !== undefined &&
        next.city &&
        !facets?.suppliers.some(
          (supplier) =>
            supplier.city === next.city && supplier.province === next.province,
        )
      ) {
        next.city = "";
      }
      return next;
    });
    setError("");
  }

  function resetDraft() {
    setDraft({ ...DEFAULT_FILTERS });
    setError("");
  }

  function apply() {
    const message = validateFilters(draft);
    if (message) {
      setError(message);
      return;
    }
    onApply({
      ...draft,
      minPrice: draft.minPrice.trim(),
      maxPrice: draft.maxPrice.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[85dvh] sm:rounded-3xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#e6ebe2] px-5 py-4">
          <div>
            <h2
              id="filter-sheet-title"
              className="flex items-center gap-2 text-base font-black tracking-tight text-[#17251b]"
            >
              <SlidersIcon className="h-4 w-4 text-[#17633a]" />
              Filter products
              {activeCount ? (
                <span className="rounded-full bg-[#eef3ea] px-2 py-0.5 text-[10px] font-black text-[#17633a]">
                  {activeCount} active
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-[11px] text-[#7a847c]">
              Your search stays active while you filter.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetDraft}
              className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-[#17633a] hover:bg-[#eef3ea]"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[#dbe2d8] text-[#4c5a50] hover:bg-[#f2f5ef]"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
              Category
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update({ category: "All" })}
                aria-pressed={draft.category === "All"}
                className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${
                  draft.category === "All"
                    ? "border-[#17633a] bg-[#eef3ea] text-[#17633a]"
                    : "border-[#dbe2d8] bg-white text-[#334138] hover:border-[#b9c8b4]"
                }`}
              >
                All categories
              </button>
              {categories.map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  onClick={() => update({ category: category.name })}
                  aria-pressed={draft.category === category.name}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${
                    draft.category === category.name
                      ? "border-[#17633a] bg-[#eef3ea] text-[#17633a]"
                      : "border-[#dbe2d8] bg-white text-[#334138] hover:border-[#b9c8b4]"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
              Price range
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] font-bold text-[#69756c]">
                  Minimum
                </span>
                <div className="mt-1 flex items-center rounded-xl border border-[#dbe2d8] bg-white px-3 focus-within:border-[#17633a] focus-within:ring-2 focus-within:ring-[#17633a]/15">
                  <span className="text-xs font-bold text-[#7a847c]">R</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={draft.minPrice}
                    onChange={(event) => update({ minPrice: event.target.value })}
                    placeholder="Any"
                    className="w-full bg-transparent px-2 py-2.5 text-sm text-[#17251b] outline-none placeholder:text-[#a3aca3]"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-[#69756c]">
                  Maximum
                </span>
                <div className="mt-1 flex items-center rounded-xl border border-[#dbe2d8] bg-white px-3 focus-within:border-[#17633a] focus-within:ring-2 focus-within:ring-[#17633a]/15">
                  <span className="text-xs font-bold text-[#7a847c]">R</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={draft.maxPrice}
                    onChange={(event) => update({ maxPrice: event.target.value })}
                    placeholder="Any"
                    className="w-full bg-transparent px-2 py-2.5 text-sm text-[#17251b] outline-none placeholder:text-[#a3aca3]"
                  />
                </div>
              </label>
            </div>
            {facets &&
            facets.priceRange.min !== null &&
            facets.priceRange.max !== null ? (
              <p className="mt-2 text-[10px] text-[#7a847c]">
                Available products range from{" "}
                {formatRand(facets.priceRange.min)} to{" "}
                {formatRand(facets.priceRange.max)}.
              </p>
            ) : null}
          </section>

          {facets && facets.provinces.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
                Location
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-bold text-[#69756c]">
                    Province
                  </span>
                  <select
                    value={draft.province}
                    onChange={(event) => update({ province: event.target.value })}
                    className="mt-1 w-full rounded-xl border border-[#dbe2d8] bg-white px-3 py-2.5 text-sm text-[#17251b] outline-none focus:border-[#17633a]"
                  >
                    <option value="">All provinces</option>
                    {facets.provinces.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold text-[#69756c]">
                    City or town
                  </span>
                  <select
                    value={draft.city}
                    onChange={(event) => update({ city: event.target.value })}
                    disabled={cityOptions.length === 0}
                    className="mt-1 w-full rounded-xl border border-[#dbe2d8] bg-white px-3 py-2.5 text-sm text-[#17251b] outline-none focus:border-[#17633a] disabled:bg-[#f6f8f4] disabled:text-[#98a199]"
                  >
                    <option value="">All cities</option>
                    {cityOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {facets && facets.suppliers.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
                Seller
              </h3>
              <select
                value={draft.supplierId}
                onChange={(event) => update({ supplierId: event.target.value })}
                className="mt-2 w-full rounded-xl border border-[#dbe2d8] bg-white px-3 py-2.5 text-sm text-[#17251b] outline-none focus:border-[#17633a]"
              >
                <option value="">All sellers</option>
                {facets.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.businessName}
                  </option>
                ))}
              </select>
            </section>
          ) : null}

          <section>
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7a847c]">
              Sort by
            </h3>
            <div className="mt-2 space-y-1.5">
              {SORT_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                    draft.sort === option.value
                      ? "border-[#17633a] bg-[#eef3ea] text-[#17633a]"
                      : "border-[#dbe2d8] bg-white text-[#334138] hover:border-[#b9c8b4]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="marketplace-sort"
                      value={option.value}
                      checked={draft.sort === option.value}
                      onChange={() => update({ sort: option.value })}
                      className="h-4 w-4 accent-[#17633a]"
                    />
                    {option.label}
                  </span>
                  {draft.sort === option.value ? (
                    <span className="text-[9px] font-black uppercase tracking-wide text-[#17633a]">
                      Selected
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </section>
        </div>

        <footer className="space-y-3 border-t border-[#e6ebe2] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          {error ? (
            <p role="alert" className="text-[11px] font-semibold text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetDraft}
              className="flex-1 rounded-xl border border-[#ccd5ca] bg-white py-3 text-xs font-black text-[#243229] transition hover:bg-[#f2f4ef]"
            >
              Reset filters
            </button>
            <button
              type="button"
              onClick={apply}
              className="flex-[1.4] rounded-xl bg-[#17633a] py-3 text-xs font-black text-white transition hover:bg-[#0f4d2b]"
            >
              Show results
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
