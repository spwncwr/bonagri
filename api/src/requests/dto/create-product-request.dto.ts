import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateProductRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  destinationCity?: string;

  @IsOptional()
  @IsDateString()
  requiredBy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
