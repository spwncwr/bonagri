import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { VerificationStatus } from "../../common/types";

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "NOT_STARTED",
  "PENDING",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
];

export class AdminVerificationQueryDto {
  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  status?: VerificationStatus;

  @IsOptional()
  @IsIn(["SUPPLIER", "AGRO_DEALER"])
  role?: "SUPPLIER" | "AGRO_DEALER";

  // Business name, applicant email or application id.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  // Inclusive lower bound on submission date (yyyy-mm-dd, account timezone).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "submittedFrom must be yyyy-mm-dd",
  })
  submittedFrom?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}
