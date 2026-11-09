import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

// Account settings every role shares. Email is deliberately absent: it is
// the login identity and would need re-verification, so it stays read-only
// on the settings screens.
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  // Phone is a contact detail, so it may be cleared.
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  // https URL (Cloudinary upload result or external), or null to clear.
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  avatarUrl?: string | null;
}
