import { Type } from "class-transformer";
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateRequestResponseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  // F1: quotes are product-backed — the supplier attaches their own active
  // listing so an accepted quote can convert into an order (validated
  // against the caller's profile in the service, not just any UUID).
  @IsUUID()
  productId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000000)
  quotedPrice?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  quotedUnit?: string;
}
