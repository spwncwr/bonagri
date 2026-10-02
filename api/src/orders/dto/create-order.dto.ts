import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";

export class CreateOrderDto {
  @IsUUID()
  deliveryAddressId!: string;

  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
