import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import type { VerificationDocumentKind } from "../../common/types";

export const DOCUMENT_KINDS: VerificationDocumentKind[] = [
  "BUSINESS_REGISTRATION",
  "BUSINESS_LICENCE",
  "AGRICULTURAL_INPUT_LICENCE",
  "PROOF_OF_BUSINESS_ADDRESS",
  "OWNER_ID",
  "OTHER",
];

// Server-generated ids only — the media signature endpoint produces these,
// and anything else would let a client point us at another app's assets.
const VERIFICATION_PUBLIC_ID = /^bonagri\/verification\/[A-Za-z0-9_-]{8,128}$/;

// Matches the existing client-side upload limits (5 MB) plus PDFs, which the
// verification flow accepts for registration evidence.
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export class VerificationDocumentDto {
  @IsIn(DOCUMENT_KINDS)
  kind!: VerificationDocumentKind;

  @IsString()
  @Matches(VERIFICATION_PUBLIC_ID, {
    message: "Invalid document reference",
  })
  publicId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  sizeBytes?: number;
}

// Used for both the first submission and the corrections resubmission — the
// applicant only re-sends what changed.
export class SubmitVerificationApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  businessName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  @Matches(/^\+?[0-9][0-9\s\-().]{6,19}$/, {
    message: "Enter a valid business contact number",
  })
  contactPhone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  physicalAddress!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  representativeName!: string;

  // Extra role/category-specific answers (today: licenceCategories for
  // agro-dealers). Sanitised to known keys before storage.
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => VerificationDocumentDto)
  documents!: VerificationDocumentDto[];
}
