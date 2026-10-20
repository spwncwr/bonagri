import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
} from "class-validator";

export class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsString()
  sku!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsString()
  unit!: string;

  // CP16a: image must be an https URL (Cloudinary upload result or external).
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @IsIn(["DRAFT", "ACTIVE", "INACTIVE"])
  status?: "DRAFT" | "ACTIVE" | "INACTIVE";

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockLevel?: number;
}
