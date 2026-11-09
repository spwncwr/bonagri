import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export type AdminVerificationAction =
  | "start_review"
  | "approve"
  | "reject"
  | "request_info"
  | "suspend";

export class AdminVerificationActionDto {
  @IsIn([
    "start_review",
    "approve",
    "reject",
    "request_info",
    "suspend",
  ])
  action!: AdminVerificationAction;

  // Meaningful reasons are mandatory for reject / request_info / suspend —
  // enforced in the service (the applicant is shown this text).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  // Internal review notes — admin-only, never shown to the applicant.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
