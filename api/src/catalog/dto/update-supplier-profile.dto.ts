import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

// CP16a: supplier storefront branding (the logo) plus the business details a
// settings page lets the vendor maintain itself. `registrationNo` and
// `verified` stay out: the first is the legal identifier admin/apply set,
// the second is an admin decision.
export class UpdateSupplierProfileDto {
  // https URL (Cloudinary upload result or external), or null to clear.
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  // Public contact address shown to buyers — not the login identity.
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  province?: string | null;
}
