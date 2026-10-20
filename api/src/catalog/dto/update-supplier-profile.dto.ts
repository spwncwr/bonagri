import { IsOptional, IsUrl } from "class-validator";

// CP16a: supplier storefront branding. Only the logo lands in this phase —
// the rest of the profile stays admin-seeded until a real settings page
// justifies widening it.
export class UpdateSupplierProfileDto {
  // https URL (Cloudinary upload result or external), or null to clear.
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  logoUrl?: string | null;
}
