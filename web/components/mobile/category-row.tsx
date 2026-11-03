"use client";

import { BasketIcon } from "./icons";
import { getCategoryIcon } from "./category-icons";

// Categories have no images in BonAgri (name/slug/description only), so the
// discs are decorative: a soft tinted circle with a real stroke icon for the
// category (no emoji — those render differently per platform). The name under
// each disc is the real category name that drives the marketplace filter.

const TINTS = [
  "from-[#e3f0e2] to-[#d2e7d3]",
  "from-[#fdeae1] to-[#f7d9cc]",
  "from-[#e7f1dd] to-[#d6e8c6]",
  "from-[#fbe4e1] to-[#f3cfcb]",
  "from-[#fdf1d9] to-[#f7e3ba]",
  "from-[#e6f0ea] to-[#cfe3d7]",
];

type CategoryRowProps = {
  categories: string[];
  active: string;
  categoryImages?: Record<string, string | null | undefined>;
  onPick: (name: string) => void;
  onViewAll: () => void;
};

export default function CategoryRow({
  categories,
  active,
  categoryImages,
  onPick,
  onViewAll,
}: CategoryRowProps) {
  return (
    <section aria-label="Categories">
      <div className="mb-2.5 flex items-center justify-between px-1">
        <h2 className="text-sm font-black tracking-tight">Categories</h2>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[11px] font-black uppercase tracking-wide text-[#17633a]"
        >
          View all
        </button>
      </div>

      <div className="flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onPick("All")}
          className="flex w-14 shrink-0 flex-col items-center gap-1.5"
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br text-[#2f5b3c] shadow-sm ring-2 transition ${
              active === "All"
                ? "from-[#dcecdf] to-[#c4dfc9] ring-[#17633a]"
                : "from-[#eaf1e8] to-[#dbe6d9] ring-transparent"
            }`}
          >
            <BasketIcon className="h-6 w-6" />
          </span>
          <span
            className={`w-full text-center text-[10px] font-bold leading-tight ${
              active === "All" ? "text-[#17633a]" : "text-[#5d695f]"
            }`}
          >
            All
          </span>
        </button>

        {categories.map((name, index) => {
          const isActive = active === name;
          const Icon = getCategoryIcon(name);
          const imageUrl = categoryImages?.[name];

          return (
            <button
              key={name}
              type="button"
              onClick={() => onPick(name)}
              className="flex w-14 shrink-0 flex-col items-center gap-1.5"
            >
              <span
                className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br text-[#2f5b3c] shadow-sm ring-2 transition ${
                  imageUrl
                    ? "bg-slate-100 ring-offset-1"
                    : TINTS[index % TINTS.length]
                } ${isActive ? "ring-[#17633a]" : "ring-transparent"}`}
              >
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={name}
                    className="h-full w-full object-cover transition duration-300 hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <Icon className="h-6 w-6" />
                )}
              </span>
              <span
                className={`w-full text-center text-[10px] font-bold leading-tight ${
                  isActive ? "text-[#17633a]" : "text-[#5d695f]"
                }`}
              >
                {name}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onViewAll}
          className="flex w-14 shrink-0 flex-col items-center gap-1.5"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-[#b9c5b8] bg-white text-lg font-black text-[#17633a]">
            +
          </span>
          <span className="w-full text-center text-[10px] font-bold leading-tight text-[#5d695f]">
            More
          </span>
        </button>
      </div>
    </section>
  );
}
