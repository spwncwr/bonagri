"use client";

import { buildImageUrl } from "../../lib/media";
import { CheckIcon } from "./icons";
import RatingStars from "./rating-stars";

export type MobileProduct = {
  id: string;
  name: string;
  category: string;
  location: string;
  price: string;
  unit: string;
  supplier: string;
  verified: boolean;
  availableQuantity: number;
  imageUrl: string | null;
  // CP17: real rating summary from the API (null/0 = no reviews yet).
  ratingAverage: number | null;
  ratingCount: number;
  tone: string;
  visual: string;
};

type ProductCardProps = {
  product: MobileProduct;
  onOpen: () => void;
  onAdd: () => void;
};

// Reference layout: rounded square photo, name, then one row with the price
// per unit on the left and the real rating on the right, then a full-width
// Add to Cart button. The details sit directly on the page background — no
// card container. Tapping the image opens the product screen.
export default function ProductCard({ product, onOpen, onAdd }: ProductCardProps) {
  const imageUrl = buildImageUrl(product.imageUrl, 640);
  const outOfStock = product.availableQuantity <= 0;
  const hasRating = product.ratingCount > 0 && product.ratingAverage !== null;

  return (
    <article className="flex flex-col transition active:scale-[0.985]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View ${product.name}`}
        className="block w-full text-left"
      >
        {/* Rounded square product image */}
        <div
          className={`relative aspect-square overflow-hidden rounded-2xl ${product.tone}`}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-black tracking-tight text-[#304635]/70">
              {product.visual}
            </span>
          </div>

          {/* CP16b: supplier photo covers the tone panel; on load error it
              hides and the tone/visual fallback shows again. Plain <img> is
              deliberate — Cloudinary serves the resized bytes. */}
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

          <div className="absolute left-2 top-2 max-w-[72%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-[#17633a]">
            {product.category}
          </div>

          {/* Social-style verified badge (blue disc + white check). */}
          {product.verified ? (
            <span
              className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#1877f2] shadow-sm ring-2 ring-white"
              role="img"
              aria-label="Business verified supplier"
            >
              <CheckIcon className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
          ) : null}

          {outOfStock ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <span className="rounded-full bg-[#17251b] px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                Out of stock
              </span>
            </div>
          ) : null}
        </div>

        {/* Details: no container — straight on the page background. */}
        <div>
          <h3 className="mt-2 truncate text-[13px] font-black leading-tight text-[#17251b]">
            {product.name}
          </h3>

          {/* Price left, rating right — one row, tight against the name. */}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="shrink-0 truncate text-[15px] font-black text-[#17633a]">
              {product.price}
              {/* mapApiProduct already formats the unit as "/ kg". */}
              <span className="ml-1 text-[10px] font-bold text-[#7b867d]">
                {product.unit}
              </span>
            </span>

            {hasRating ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px]">
                <RatingStars
                  value={product.ratingAverage ?? 0}
                  className="h-2.5 w-2.5"
                />
                <span className="font-black text-[#27382b]">
                  {product.ratingAverage?.toFixed(1)}
                </span>
                <span className="font-semibold text-[#8a948b]">
                  ({product.ratingCount})
                </span>
              </span>
            ) : (
              // No rating yet — say nothing rather than breaking the row on
              // narrow screens; the price stays left-aligned either way.
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-[#9aa49b]">
                New
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="mt-2.5">
        <button
          type="button"
          onClick={onAdd}
          disabled={outOfStock}
          aria-label={`Add ${product.name} to cart`}
          className="w-full rounded-xl bg-[#17633a] py-2.5 text-xs font-black text-white transition hover:bg-[#0f4d2b] disabled:cursor-not-allowed disabled:bg-[#c3ccc2]"
        >
          Add to Cart
        </button>
      </div>
    </article>
  );
}
