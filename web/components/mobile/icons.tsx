// The app's icon set: Hugeicons (https://hugeicons.com/) — free pack
// (@hugeicons/core-free-icons, Stroke Rounded) rendered through the official
// @hugeicons/react wrapper. Every screen imports from this module so the
// whole app shares one icon family.
//
// Each export keeps the old signature ({ className }) so call sites did not
// have to change; the className carries the size (h-5 w-5 etc.) and, where
// used, the color (currentColor).

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowExpand01Icon as ExpandGlyph,
  ArrowLeftIcon as ArrowLeftGlyph,
  ArrowRightIcon as ArrowRightGlyph,
  ArrowShrink01Icon as ShrinkGlyph,
  BellIcon as BellGlyph,
  BoxIcon as BoxGlyph,
  Call02Icon as CallGlyph,
  Camera01Icon as CameraGlyph,
  Cancel01Icon as CloseGlyph,
  CheckIcon as CheckGlyph,
  ChevronRightIcon as ChevronRightGlyph,
  Compass01Icon as CompassGlyph,
  Globe02Icon as GlobeGlyph,
  HelpCircleIcon as HelpGlyph,
  Home03Icon as HomeGlyph,
  InformationCircleIcon as InfoGlyph,
  ListIcon as ListGlyph,
  LogoutIcon as LogoutGlyph,
  MapPinIcon as MapPinGlyph,
  MegaphoneIcon as MegaphoneGlyph,
  Menu02Icon as MenuGlyph,
  MinusIcon as MinusGlyph,
  Moon02Icon as MoonGlyph,
  PlusIcon as PlusGlyph,
  Search01Icon as SearchGlyph,
  Settings01Icon as SettingsGlyph,
  ShieldIcon as ShieldGlyph,
  ShoppingBasket01Icon as BasketGlyph,
  SlidersHorizontalIcon as SlidersGlyph,
  StarIcon as StarGlyph,
  StoreIcon as StoreGlyph,
  Sun01Icon as SunGlyph,
  TranslateIcon as TranslateGlyph,
  TrashIcon as TrashGlyph,
  TruckIcon as TruckGlyph,
  UserIcon as UserGlyph,
} from "@hugeicons/core-free-icons";

type IconProps = { className?: string; strokeWidth?: number };

// 1.8 matches the strokeWidth the hand-drawn set used, so weights stay
// consistent everywhere (sizes are set by the caller's Tailwind classes).
// Small badges pass a bigger strokeWidth so the line stays visible when the
// icon is scaled down.
function wrap(icon: IconSvgElement, fallback: string) {
  return function Icon({ className = fallback, strokeWidth = 1.8 }: IconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        className={className}
        strokeWidth={strokeWidth}
        aria-hidden="true"
      />
    );
  };
}

export const HomeIcon = wrap(HomeGlyph, "h-5 w-5");
export const SearchIcon = wrap(SearchGlyph, "h-5 w-5");
export const BasketIcon = wrap(BasketGlyph, "h-5 w-5");
export const UserIcon = wrap(UserGlyph, "h-5 w-5");
export const BellIcon = wrap(BellGlyph, "h-5 w-5");
export const SlidersIcon = wrap(SlidersGlyph, "h-5 w-5");
export const PlusIcon = wrap(PlusGlyph, "h-4 w-4");
export const MinusIcon = wrap(MinusGlyph, "h-4 w-4");
export const ChevronRightIcon = wrap(ChevronRightGlyph, "h-4 w-4");
export const ArrowRightIcon = wrap(ArrowRightGlyph, "h-4 w-4");
export const ArrowLeftIcon = wrap(ArrowLeftGlyph, "h-4 w-4");
export const CloseIcon = wrap(CloseGlyph, "h-4 w-4");
export const CheckIcon = wrap(CheckGlyph, "h-4 w-4");
// CP17: verification centre glyph — same check, sized like the rail icons.
export const VerifiedIcon = wrap(CheckGlyph, "h-5 w-5");
export const TrashIcon = wrap(TrashGlyph, "h-4 w-4");
export const MapPinIcon = wrap(MapPinGlyph, "h-4 w-4");
export const BoxIcon = wrap(BoxGlyph, "h-5 w-5");
export const ListIcon = wrap(ListGlyph, "h-5 w-5");
export const MegaphoneIcon = wrap(MegaphoneGlyph, "h-5 w-5");
export const MenuIcon = wrap(MenuGlyph, "h-5 w-5");
export const StoreIcon = wrap(StoreGlyph, "h-5 w-5");
export const LogoutIcon = wrap(LogoutGlyph, "h-5 w-5");
export const ShieldIcon = wrap(ShieldGlyph, "h-5 w-5");
export const TruckIcon = wrap(TruckGlyph, "h-5 w-5");
export const StarIcon = wrap(StarGlyph, "h-4 w-4");
export const CameraIcon = wrap(CameraGlyph, "h-4 w-4");
export const MoonIcon = wrap(MoonGlyph, "h-5 w-5");
export const SunIcon = wrap(SunGlyph, "h-5 w-5");
export const GlobeIcon = wrap(GlobeGlyph, "h-5 w-5");
export const SettingsIcon = wrap(SettingsGlyph, "h-5 w-5");
export const HelpIcon = wrap(HelpGlyph, "h-5 w-5");
export const InfoIcon = wrap(InfoGlyph, "h-5 w-5");
export const CallIcon = wrap(CallGlyph, "h-5 w-5");
export const TranslateIcon = wrap(TranslateGlyph, "h-5 w-5");
export const CompassIcon = wrap(CompassGlyph, "h-4 w-4");
export const ExpandIcon = wrap(ExpandGlyph, "h-4 w-4");
export const ShrinkIcon = wrap(ShrinkGlyph, "h-4 w-4");
