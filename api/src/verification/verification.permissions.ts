import { ForbiddenException } from "@nestjs/common";
import type { VerificationStatus } from "../common/types";

// CP17: the ONE place marketplace access decisions are made. Cart checkout,
// product publishing and order acceptance call these helpers instead of
// scattering status checks — the machine-readable `code` lets the web app
// route the user to the right verification screen.
export const VERIFICATION_CODES = {
  PHONE_REQUIRED: "PHONE_VERIFICATION_REQUIRED",
  BUSINESS_REQUIRED: "BUSINESS_VERIFICATION_REQUIRED",
} as const;

export type VerificationCode =
  (typeof VERIFICATION_CODES)[keyof typeof VERIFICATION_CODES];

// Buyers may browse, search, cart and save addresses unverified — only the
// money-moving step (placing an order) requires a confirmed phone number.
export function assertPhoneVerified(user: {
  phoneVerifiedAt: Date | null;
}): void {
  if (!user.phoneVerifiedAt) {
    throw new ForbiddenException({
      message:
        "Verify your phone number with the one-time code we email you before placing an order.",
      code: VERIFICATION_CODES.PHONE_REQUIRED,
    });
  }
}

// Suppliers and agro-dealers may register, build their profile and submit an
// application, but publishing listings and accepting orders require an
// admin-approved business verification.
export function assertBusinessVerified(businessStatus: VerificationStatus): void {
  if (businessStatus === "VERIFIED") {
    return;
  }

  const messages: Record<VerificationStatus, string> = {
    NOT_STARTED:
      "Submit your business verification application to publish products and accept orders.",
    PENDING:
      "Your business verification is awaiting admin review. You can publish products and accept orders once it is approved.",
    UNDER_REVIEW:
      "Your business verification is under review. You can publish products and accept orders once it is approved.",
    ACTION_REQUIRED:
      "Your business verification needs updated information before products can be published or orders accepted.",
    REJECTED:
      "Your business verification was rejected. Resubmit it to publish products and accept orders.",
    SUSPENDED:
      "Your business verification is suspended. Contact the BonAgri team to restore it.",
    VERIFIED: "",
  };

  throw new ForbiddenException({
    message: messages[businessStatus],
    code: VERIFICATION_CODES.BUSINESS_REQUIRED,
    businessStatus,
  });
}
