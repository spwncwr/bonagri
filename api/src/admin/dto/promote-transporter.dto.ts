import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

// CP14: admin promotes a user to TRANSPORTER and creates the profile
// exactly once (mirrors PromoteSupplierDto).
export class PromoteTransporterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  businessName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  // Provinces this transporter serves; drives the claim-board filter.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  serviceProvinces!: string[];
}
