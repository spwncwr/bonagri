import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";

export class CreateProductDto {
  @IsUUID()
  supplierId!: string;

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

  @IsOptional()
  @IsString()
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
