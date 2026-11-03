import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from "class-validator";

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  eyebrow?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ctaText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ctaLink?: string;

  @IsOptional()
  @IsUrl({ protocols: ["https", "http"], require_protocol: true })
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  targetRole?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
