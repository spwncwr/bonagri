// Shared string-literal unions mirroring the Prisma enums.
// Keep in sync with api/prisma/schema.prisma (enum UserRole / enum UserStatus).
export type UserRole =
  | "BUYER"
  | "SUPPLIER"
  | "AGRO_DEALER"
  | "TRANSPORTER"
  | "ADMIN";

export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING";
