// Shared string-literal unions mirroring the Prisma enums.
// Keep in sync with api/prisma/schema.prisma (enum UserRole / enum UserStatus).
export type UserRole =
  | "BUYER"
  | "SUPPLIER"
  | "AGRO_DEALER"
  | "TRANSPORTER"
  | "ADMIN";

export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING";

// Shared string-literal unions mirroring the Prisma verification enums
// (enum VerificationStatus / VerificationAction / VerificationDocumentKind).
export type VerificationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

export type VerificationAction =
  | "SUBMITTED"
  | "RESUBMITTED"
  | "STARTED_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "INFO_REQUESTED"
  | "SUSPENDED";

export type VerificationDocumentKind =
  | "BUSINESS_REGISTRATION"
  | "BUSINESS_LICENCE"
  | "AGRICULTURAL_INPUT_LICENCE"
  | "PROOF_OF_BUSINESS_ADDRESS"
  | "OWNER_ID"
  | "OTHER";
