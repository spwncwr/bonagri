import { ForbiddenException } from "@nestjs/common";
import {
  assertBusinessVerified,
  assertPhoneVerified,
  VERIFICATION_CODES,
} from "./verification.permissions";

// CP17: the shared marketplace gate. Both helpers must fail with a
// machine-readable code the web app routes on — never a silent pass.
describe("verification permissions (CP17 marketplace gating)", () => {
  describe("assertPhoneVerified", () => {
    it("passes a buyer with a confirmed phone", () => {
      expect(() =>
        assertPhoneVerified({ phoneVerifiedAt: new Date() }),
      ).not.toThrow();
    });

    it("blocks an unverified buyer with PHONE_VERIFICATION_REQUIRED", () => {
      const error = (() => {
        try {
          assertPhoneVerified({ phoneVerifiedAt: null });
          return null;
        } catch (caught) {
          return caught as ForbiddenException;
        }
      })();

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error?.getResponse()).toMatchObject({
        code: VERIFICATION_CODES.PHONE_REQUIRED,
      });
      expect(VERIFICATION_CODES.PHONE_REQUIRED).toBe(
        "PHONE_VERIFICATION_REQUIRED",
      );
    });
  });

  describe("assertBusinessVerified", () => {
    it("passes only VERIFIED", () => {
      expect(() => assertBusinessVerified("VERIFIED")).not.toThrow();
    });

    it.each([
      "NOT_STARTED",
      "PENDING",
      "UNDER_REVIEW",
      "ACTION_REQUIRED",
      "REJECTED",
      "SUSPENDED",
    ] as const)("blocks %s with an actionable message", (status) => {
      const error = (() => {
        try {
          assertBusinessVerified(status);
          return null;
        } catch (caught) {
          return caught as ForbiddenException;
        }
      })();

      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error?.getResponse() as {
        code: string;
        businessStatus: string;
        message: string;
      };
      expect(response.code).toBe(VERIFICATION_CODES.BUSINESS_REQUIRED);
      expect(response.businessStatus).toBe(status);
      expect(response.message.length).toBeGreaterThan(20);
    });
  });
});
