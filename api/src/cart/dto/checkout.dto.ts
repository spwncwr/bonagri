import { IsOptional, IsString, IsUUID } from "class-validator";

export class CheckoutDto {
  @IsUUID()
  deliveryAddressId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
