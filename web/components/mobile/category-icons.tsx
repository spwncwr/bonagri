// Real vector icons for the category discs — the discs used to show emoji,
// which render differently per platform. Icons come from the same Hugeicons
// pack as the rest of the app (see ./icons.tsx), so the whole UI shares one
// icon family.

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AppleIcon,
  CarrotIcon,
  EggIcon,
  JarIcon,
  Leaf01Icon,
  PepperIcon,
  SproutIcon,
  WheatIcon,
  WrenchIcon,
} from "@hugeicons/core-free-icons";

type IconProps = { className?: string };

function wrap(icon: IconSvgElement) {
  return function CategoryIcon({ className = "h-6 w-6" }: IconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        className={className}
        strokeWidth={1.8}
        aria-hidden="true"
      />
    );
  };
}

// Fresh Produce — a leaf.
const LeafIcon = wrap(Leaf01Icon);
// Fruits — an apple.
const FruitIcon = wrap(AppleIcon);
// Vegetables — a carrot.
const VegIcon = wrap(CarrotIcon);
// Chilli & Sauces — a pepper.
const ChilliIcon = wrap(PepperIcon);
// Processed Foods — a jar/tin.
const CanIcon = wrap(JarIcon);
// Poultry & Livestock — an egg.
const PoultryIcon = wrap(EggIcon);
// Farm Inputs — a wheat stalk.
const WheatIconComponent = wrap(WheatIcon);
// Seeds & Chemicals — a sprout.
const SproutIconComponent = wrap(SproutIcon);
// Agricultural Tools & Equipment — a wrench.
const WrenchIconComponent = wrap(WrenchIcon);

// Category display name -> icon. Names come from the marketplace filter
// (CATEGORY_CARDS in home-shell), which mirrors the seeded platform
// categories; unknown names fall back to the leaf.
export const CATEGORY_ICONS: Record<string, ReturnType<typeof wrap>> = {
  "Fresh Produce": LeafIcon,
  Fruits: FruitIcon,
  Vegetables: VegIcon,
  "Chilli & Sauces": ChilliIcon,
  "Processed Foods": CanIcon,
  "Poultry & Livestock": PoultryIcon,
  "Farm Inputs": WheatIconComponent,
  "Seeds & Chemicals": SproutIconComponent,
  "Agricultural Tools & Equipment": WrenchIconComponent,
};

export function getCategoryIcon(name: string): ReturnType<typeof wrap> {
  return CATEGORY_ICONS[name] ?? LeafIcon;
}
