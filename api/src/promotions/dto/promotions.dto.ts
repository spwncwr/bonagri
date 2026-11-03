import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export const PROMO_CAMPAIGN_TYPES = [
  "FEATURED_PRODUCTS",
  "NEAR_YOU",
  "SPECIAL_OFFERS",
  "DISCOVER_CATEGORIES",
  "FEATURED_SHOPS",
] as const;

export const PROMO_CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
] as const;

export const PROMO_CAMPAIGN_PLACEMENTS = [
  "HOME_TOP",
  "HOME_MID",
  "EXPLORE_TOP",
  "EXPLORE_MID",
] as const;

export const PROMO_CARD_LAYOUTS = [
  "BANNER",
  "SPLIT",
  "COMPACT",
  "EDITORIAL",
  "CAROUSEL",
] as const;

export const PROMO_DESTINATION_TYPES = [
  "PRODUCT",
  "CATEGORY",
  "SHOP",
  "NONE",
] as const;

export type PromoCampaignTypeValue = (typeof PROMO_CAMPAIGN_TYPES)[number];
export type PromoCampaignStatusValue = (typeof PROMO_CAMPAIGN_STATUSES)[number];
export type PromoCampaignPlacementValue =
  (typeof PROMO_CAMPAIGN_PLACEMENTS)[number];
export type PromoCardLayoutValue = (typeof PROMO_CARD_LAYOUTS)[number];
export type PromoDestinationTypeValue =
  (typeof PROMO_DESTINATION_TYPES)[number];

export class PromoCampaignImageDto {
  @IsUrl({ protocols: ["https", "http"], require_protocol: true })
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;
}

export class PromoCampaignProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  promoPrice?: number | null;
}

export class CreatePromoCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  headline!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsIn(PROMO_CAMPAIGN_TYPES)
  type!: PromoCampaignTypeValue;

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_STATUSES)
  status?: PromoCampaignStatusValue;

  @IsOptional()
  @IsIn(PROMO_CARD_LAYOUTS)
  layout?: PromoCardLayoutValue;

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_PLACEMENTS)
  placement?: PromoCampaignPlacementValue;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ctaText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsBoolean()
  isSponsored?: boolean;

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsIn(PROMO_DESTINATION_TYPES)
  destinationType?: PromoDestinationTypeValue;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  destinationId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PromoCampaignImageDto)
  images?: PromoCampaignImageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PromoCampaignProductDto)
  products?: PromoCampaignProductDto[];
}

export class UpdatePromoCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_TYPES)
  type?: PromoCampaignTypeValue;

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_STATUSES)
  status?: PromoCampaignStatusValue;

  @IsOptional()
  @IsIn(PROMO_CARD_LAYOUTS)
  layout?: PromoCardLayoutValue;

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_PLACEMENTS)
  placement?: PromoCampaignPlacementValue;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ctaText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsBoolean()
  isSponsored?: boolean;

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsIn(PROMO_DESTINATION_TYPES)
  destinationType?: PromoDestinationTypeValue;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  destinationId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PromoCampaignImageDto)
  images?: PromoCampaignImageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => PromoCampaignProductDto)
  products?: PromoCampaignProductDto[];
}

export class ListPromotionsDto {
  @IsIn(PROMO_CAMPAIGN_PLACEMENTS)
  placement!: PromoCampaignPlacementValue;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class ListAdminCampaignsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn([...PROMO_CAMPAIGN_STATUSES, "EXPIRED", "ALL"])
  status?: PromoCampaignStatusValue | "EXPIRED" | "ALL";

  @IsOptional()
  @IsIn(PROMO_CAMPAIGN_PLACEMENTS)
  placement?: PromoCampaignPlacementValue;
}

export class PromoEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  campaignId!: string;

  @IsIn(["IMPRESSION", "CLICK"])
  type!: "IMPRESSION" | "CLICK";

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  eventKey!: string;
}

export class TrackPromoEventsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PromoEventDto)
  events!: PromoEventDto[];
}
