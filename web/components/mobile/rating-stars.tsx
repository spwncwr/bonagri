import { StarIcon } from "./icons";

// Rating stars, rendered with the app's Hugeicons set instead of ★ text
// glyphs so the whole UI shares one icon family. Five stars, gold when
// filled, muted outline when empty (values are rounded averages).
type RatingStarsProps = {
  value: number;
  className?: string;
};

export default function RatingStars({
  value,
  className = "h-3 w-3",
}: RatingStarsProps) {
  const filled = Math.round(value);

  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <StarIcon
          key={index}
          strokeWidth={2.2}
          className={`${className} ${
            index < filled ? "text-[#e0a92b]" : "text-[#d7ded4]"
          }`}
        />
      ))}
    </span>
  );
}
