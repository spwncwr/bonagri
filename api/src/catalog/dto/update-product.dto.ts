import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from "class-validator";

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  // CP16a: https URL to replace the image, or null to clear it (which also
  // destroys our managed Cloudinary asset server-side). Omit to leave as-is.
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  imageUrl?: string | null;

  @IsOptional()
  @IsIn(["DRAFT", "ACTIVE", "INACTIVE"])
  status?: "DRAFT" | "ACTIVE" | "INACTIVE";
}
