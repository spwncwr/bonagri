import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateSellerApplicationDto {
  @IsIn(["SUPPLIER", "AGRO_DEALER"])
  desiredRole!: "SUPPLIER" | "AGRO_DEALER";

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  businessName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
