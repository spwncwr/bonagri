import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VerificationService } from "./verification.service";

function otpHash(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

function makeService() {
  const tx = {
    user: { update: jest.fn() },
    supplierProfile: { updateMany: jest.fn() },
    verificationApplication: { create: jest.fn(), update: jest.fn() },
  };

  const prisma = {
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        // Array form: the elements were already invoked (calls recorded)
        // and resolve to their mock results.
        return Promise.all(arg);
      }
      return (arg as (t: typeof tx) => unknown)(tx);
    }),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    phoneOtpCode: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    verificationApplication: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const mail = { sendPhoneOtpEmail: jest.fn() };
  const notifications = {
    onPhoneVerified: jest.fn(),
    onVerificationSubmitted: jest.fn(),
    onVerificationApproved: jest.fn(),
    onVerificationRejected: jest.fn(),
    onVerificationInfoRequested: jest.fn(),
    onVerificationSuspended: jest.fn(),
  };
  const media = {
    signDeliveryUrl: jest.fn(),
    destroyAsset: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new VerificationService(
      prisma as never,
      media as never,
      mail as never,
      notifications as never,
    ),
    prisma,
    tx,
    mail,
    notifications,
    media,
  };
}

const buyer = {
  id: "buyer-1",
  email: "buyer@bonagri.co.za",
  firstName: "Bongi",
  role: "BUYER",
};

const supplierUser = {
  id: "vendor-1",
  email: "vendor@bonagri.co.za",
  firstName: "Thandi",
  role: "SUPPLIER",
  businessStatus: "NOT_STARTED",
  latestApplication: null,
};

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    userId: "vendor-1",
    role: "SUPPLIER",
    status: "PENDING",
    businessName: "Thandi Fresh Produce",
    registrationNumber: "2026/001",
    contactPhone: "0821234567",
    contactEmail: "thandi@example.com",
    physicalAddress: "Polokwane, Limpopo",
    representativeName: "Thandi Mokoena",
    details: null,
    submittedAt: new Date("2026-11-01T08:00:00Z"),
    updatedAt: new Date("2026-11-01T08:00:00Z"),
    reviewedAt: null,
    reviewedById: null,
    reviewNotes: null,
    rejectionReason: null,
    infoRequest: null,
    documents: [
      {
        id: "doc-1",
        kind: "BUSINESS_REGISTRATION",
        publicId: "bonagri/verification/aaa",
        fileName: "cipc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        createdAt: new Date("2026-11-01T08:00:00Z"),
      },
    ],
    ...overrides,
  };
}

const registrationDoc = {
  kind: "BUSINESS_REGISTRATION",
  publicId: "bonagri/verification/bbb12345",
  fileName: "cipc.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
};

describe("VerificationService (CP17 buyer phone OTP)", () => {
  describe("sendPhoneOtp", () => {
    it("emails a 6-digit code and stores only its salted hash", async () => {
      const { service, prisma, mail } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.phoneOtpCode.findFirst.mockResolvedValue(null);
      prisma.phoneOtpCode.create.mockResolvedValue({ id: "otp-1" });
      mail.sendPhoneOtpEmail.mockResolvedValue(undefined);

      const result = await service.sendPhoneOtp("buyer-1", " 082 123 4567 ");

      expect(result).toMatchObject({
        sent: true,
        phone: "0821234567",
        destination: "b****@bonagri.co.za",
        expiresInSeconds: 600,
        resendInSeconds: 60,
      });

      const created = prisma.phoneOtpCode.create.mock.calls[0][0].data;
      expect(created.phone).toBe("0821234567");
      expect(created.codeHash).toMatch(/^[0-9a-f]{64}$/);
      // The plaintext code must never be stored.
      expect(created).not.toHaveProperty("code");

      const [email, , code] = mail.sendPhoneOtpEmail.mock.calls[0];
      expect(email).toBe("buyer@bonagri.co.za");
      expect(code).toMatch(/^\d{6}$/);
      expect(created.codeHash).toBe(otpHash("buyer-1", code));
    });

    it("enforces the per-user cooldown before invalidating anything", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.phoneOtpCode.findFirst.mockResolvedValue({
        createdAt: new Date(),
      });

      const error = await service
        .sendPhoneOtp("buyer-1", "0821234567")
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: "OTP_COOLDOWN",
        retryInSeconds: expect.any(Number),
      });
      expect(prisma.phoneOtpCode.create).not.toHaveBeenCalled();
      expect(prisma.phoneOtpCode.updateMany).not.toHaveBeenCalled();
    });

    it("invalidates any previous live code (single active attempt)", async () => {
      const { service, prisma, mail } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.phoneOtpCode.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 120_000),
      });
      prisma.phoneOtpCode.create.mockResolvedValue({ id: "otp-2" });
      mail.sendPhoneOtpEmail.mockResolvedValue(undefined);

      await service.sendPhoneOtp("buyer-1", "0821234567");

      expect(prisma.phoneOtpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "buyer-1", consumedAt: null },
          data: { consumedAt: expect.any(Date) },
        }),
      );
    });

    it("rejects non-buyer accounts and malformed numbers", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...buyer,
        role: "SUPPLIER",
      });
      await expect(
        service.sendPhoneOtp("vendor-1", "0821234567"),
      ).rejects.toThrow(BadRequestException);

      prisma.user.findUnique.mockResolvedValue(buyer);
      await expect(
        service.sendPhoneOtp("buyer-1", "abc"),
      ).rejects.toThrow("Enter a valid phone number");
      expect(prisma.phoneOtpCode.create).not.toHaveBeenCalled();
    });

    it("consumes the code and fails loudly when email delivery fails", async () => {
      const { service, prisma, mail } = makeService();

      prisma.user.findUnique.mockResolvedValue(buyer);
      prisma.phoneOtpCode.findFirst.mockResolvedValue(null);
      prisma.phoneOtpCode.create.mockResolvedValue({ id: "otp-3" });
      mail.sendPhoneOtpEmail.mockRejectedValue(new Error("smtp down"));

      await expect(
        service.sendPhoneOtp("buyer-1", "0821234567"),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(prisma.phoneOtpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "otp-3", consumedAt: null },
        }),
      );
    });
  });

  describe("confirmPhoneOtp", () => {
    const liveCode = (overrides: Record<string, unknown> = {}) => ({
      id: "otp-1",
      phone: "0821234567",
      codeHash: otpHash("buyer-1", "123456"),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attempts: 0,
      createdAt: new Date(),
      ...overrides,
    });

    it("verifies the phone, records it and notifies the buyer", async () => {
      const { service, prisma, notifications } = makeService();

      prisma.phoneOtpCode.findMany.mockResolvedValue([liveCode()]);
      prisma.user.findUnique.mockResolvedValue({
        phoneVerifiedAt: null,
        email: buyer.email,
        firstName: buyer.firstName,
      });

      const result = await service.confirmPhoneOtp("buyer-1", "123456");

      expect(result).toEqual({ verified: true, phone: "0821234567" });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "buyer-1" },
          data: {
            phone: "0821234567",
            phoneVerifiedAt: expect.any(Date),
          },
        }),
      );
      // Every live code is consumed — no replay after success.
      expect(prisma.phoneOtpCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "buyer-1", consumedAt: null },
        }),
      );
      expect(notifications.onPhoneVerified).toHaveBeenCalledWith(
        expect.objectContaining({ id: "buyer-1" }),
      );
    });

    it("keeps the original verifiedAt when re-verifying a new number", async () => {
      const { service, prisma } = makeService();
      const original = new Date("2026-06-01T00:00:00Z");

      prisma.phoneOtpCode.findMany.mockResolvedValue([liveCode()]);
      prisma.user.findUnique.mockResolvedValue({
        phoneVerifiedAt: original,
        email: buyer.email,
        firstName: buyer.firstName,
      });

      await service.confirmPhoneOtp("buyer-1", "123456");

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phoneVerifiedAt: original }),
        }),
      );
    });

    it("counts a wrong code and reports attempts remaining", async () => {
      const { service, prisma } = makeService();

      prisma.phoneOtpCode.findMany.mockResolvedValue([liveCode()]);
      prisma.phoneOtpCode.update.mockResolvedValue({ attempts: 1 });

      const error = await service
        .confirmPhoneOtp("buyer-1", "000000")
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "OTP_INVALID",
        attemptsRemaining: 4,
      });
      expect(prisma.phoneOtpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { attempts: { increment: 1 } },
        }),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("locks the code after too many wrong attempts", async () => {
      const { service, prisma } = makeService();

      prisma.phoneOtpCode.findMany.mockResolvedValue([
        liveCode({ attempts: 5 }),
      ]);

      const error = await service
        .confirmPhoneOtp("buyer-1", "123456")
        .catch((caught: unknown) => caught);

      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "OTP_LOCKED",
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("distinguishes expired codes from no pending code", async () => {
      const { service, prisma } = makeService();

      prisma.phoneOtpCode.findMany.mockResolvedValue([
        liveCode({ expiresAt: new Date(Date.now() - 1_000) }),
      ]);
      const expired = await service
        .confirmPhoneOtp("buyer-1", "123456")
        .catch((caught: unknown) => caught);
      expect((expired as BadRequestException).getResponse()).toMatchObject({
        code: "OTP_EXPIRED",
      });

      prisma.phoneOtpCode.findMany.mockResolvedValue([]);
      const none = await service
        .confirmPhoneOtp("buyer-1", "123456")
        .catch((caught: unknown) => caught);
      expect((none as BadRequestException).getResponse()).toMatchObject({
        code: "OTP_NOT_REQUESTED",
      });
    });
  });
});

describe("VerificationService (CP17 business applications)", () => {
  const baseDto = {
    businessName: "Thandi Fresh Produce",
    registrationNumber: "2026/001",
    contactPhone: "082 123 4567",
    contactEmail: "thandi@example.com",
    physicalAddress: "Polokwane, Limpopo",
    representativeName: "Thandi Mokoena",
    documents: [registrationDoc],
  };

  describe("submitApplication", () => {
    it("creates a PENDING application with an audit entry and syncs the summary", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.user.findUnique.mockResolvedValue(supplierUser);
      tx.verificationApplication.create.mockResolvedValue(applicationRow());

      const result = await service.submitApplication("vendor-1", baseDto);

      expect(result).toMatchObject({
        id: "app-1",
        status: "PENDING",
        businessName: "Thandi Fresh Produce",
      });
      // The applicant view never leaks the stored Cloudinary reference.
      expect(JSON.stringify(result)).not.toContain("bonagri/verification");

      expect(tx.verificationApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "vendor-1",
            role: "SUPPLIER",
            status: "PENDING",
            contactPhone: "0821234567",
            auditLogs: {
              create: expect.objectContaining({
                action: "SUBMITTED",
                toStatus: "PENDING",
              }),
            },
          }),
        }),
      );
      // Summary + badge move together with the application.
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ businessStatus: "PENDING" }),
        }),
      );
      // The User-side LatestApplication link is written in the same
      // transaction — otherwise getMe().latestApplication stays null and
      // the duplicate-application guards can never fire.
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ latestApplicationId: "app-1" }),
        }),
      );
      expect(tx.supplierProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { verified: false } }),
      );
      expect(notifications.onVerificationSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ id: "vendor-1" }),
        "Thandi Fresh Produce",
        false,
      );
    });

    it("refuses buyers — only suppliers and agro-dealers apply", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({ ...supplierUser, role: "BUYER" });

      await expect(
        service.submitApplication("buyer-1", baseDto),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.verificationApplication.create).not.toHaveBeenCalled();
    });

    it("blocks a second active application", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...supplierUser,
        latestApplication: { id: "app-old", status: "UNDER_REVIEW" },
      });

      const error = await service
        .submitApplication("vendor-1", baseDto)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "APPLICATION_EXISTS",
      });
    });

    it("refuses resubmission while already verified or suspended", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...supplierUser,
        businessStatus: "SUSPENDED",
        latestApplication: { id: "app-1", status: "SUSPENDED" },
      });

      const error = await service
        .submitApplication("vendor-1", baseDto)
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "VERIFICATION_NOT_RESUBMITTABLE",
      });
    });

    it("rejects a submission missing the required registration document", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(supplierUser);

      const error = await service
        .submitApplication("vendor-1", {
          ...baseDto,
          documents: [{ ...registrationDoc, kind: "OWNER_ID" }],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "MISSING_REQUIRED_DOCUMENTS",
        missing: ["BUSINESS_REGISTRATION"],
      });
    });

    it("requires the agro-dealer input licence only when categories are declared", async () => {
      const { service, prisma, tx } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...supplierUser,
        role: "AGRO_DEALER",
      });

      // No licence categories declared → registration evidence alone passes.
      tx.verificationApplication.create.mockResolvedValue(
        applicationRow({ role: "AGRO_DEALER" }),
      );
      await expect(
        service.submitApplication("dealer-1", baseDto),
      ).resolves.toMatchObject({ status: "PENDING" });

      // Declaring regulated categories makes the licence mandatory.
      const error = await service
        .submitApplication("dealer-1", {
          ...baseDto,
          details: { licenceCategories: ["Category B pesticides"] },
        })
        .catch((caught: unknown) => caught);

      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "MISSING_REQUIRED_DOCUMENTS",
        missing: ["AGRICULTURAL_INPUT_LICENCE"],
      });
    });

    it("opens a fresh track after a rejection and keeps the old decision", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        ...supplierUser,
        businessStatus: "REJECTED",
        latestApplication: { id: "app-old", status: "REJECTED" },
      });
      tx.verificationApplication.create.mockResolvedValue(applicationRow());

      await service.submitApplication("vendor-1", baseDto);

      expect(tx.verificationApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            auditLogs: {
              create: expect.objectContaining({
                action: "RESUBMITTED",
                fromStatus: "REJECTED",
              }),
            },
          }),
        }),
      );
      expect(notifications.onVerificationSubmitted).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        true,
      );
    });

    it("rejects a kept-document id on a first submission (no rows yet)", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(supplierUser);

      await expect(
        service.submitApplication("vendor-1", {
          ...baseDto,
          documents: [{ kind: "BUSINESS_REGISTRATION", documentId: "doc-1" }],
        }),
      ).rejects.toThrow("Invalid document reference");
      expect(prisma.verificationApplication.create).not.toHaveBeenCalled();
    });

    it("rejects documents outside the verification folder or over 5 MB", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue(supplierUser);

      await expect(
        service.submitApplication("vendor-1", {
          ...baseDto,
          documents: [
            { ...registrationDoc, publicId: "bonagri/product/steal-me" },
          ],
        }),
      ).rejects.toThrow("Invalid document reference");

      await expect(
        service.submitApplication("vendor-1", {
          ...baseDto,
          documents: [{ ...registrationDoc, sizeBytes: 6 * 1024 * 1024 }],
        }),
      ).rejects.toThrow("5 MB or smaller");
    });
  });

  describe("resubmitApplication", () => {
    it("returns an ACTION_REQUIRED application to PENDING with new documents", async () => {
      const { service, prisma, tx, media, notifications } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({
          status: "ACTION_REQUIRED",
          infoRequest: "Please upload a clearer certificate.",
          documents: [
            {
              id: "doc-old",
              kind: "BUSINESS_REGISTRATION",
              publicId: "bonagri/verification/old",
              fileName: "blurry.jpg",
              mimeType: "image/jpeg",
              sizeBytes: 500,
              createdAt: new Date(),
            },
          ],
        }),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "PENDING" }),
      );
      prisma.user.findUnique.mockResolvedValue({
        email: supplierUser.email,
        firstName: supplierUser.firstName,
      });

      const result = await service.resubmitApplication(
        "vendor-1",
        "app-1",
        baseDto,
      );

      expect(result).toMatchObject({ status: "PENDING" });
      expect(tx.verificationApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
            infoRequest: null,
            auditLogs: {
              create: expect.objectContaining({
                action: "RESUBMITTED",
                fromStatus: "ACTION_REQUIRED",
              }),
            },
          }),
        }),
      );
      // The replaced asset is cleaned up after the row commits.
      expect(media.destroyAsset).toHaveBeenCalledWith(
        "bonagri/verification/old",
      );
      // The User-side LatestApplication link is re-pointed at this row.
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ latestApplicationId: "app-1" }),
        }),
      );
      expect(tx.supplierProfile.updateMany).toHaveBeenCalled();
      expect(notifications.onVerificationSubmitted).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        true,
      );
    });

    it("only allows resubmission from ACTION_REQUIRED", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({ status: "PENDING" }),
      );

      const error = await service
        .resubmitApplication("vendor-1", "app-1", baseDto)
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "RESUBMIT_NOT_ALLOWED",
      });
    });

    // CP17: the applicant keeps unchanged documents by row id — the stored
    // Cloudinary reference never travels to the client.
    it("keeps a document referenced by its row id without re-upload", async () => {
      const { service, prisma, tx, media } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({
          status: "ACTION_REQUIRED",
          documents: [
            {
              id: "doc-keep",
              kind: "BUSINESS_REGISTRATION",
              publicId: "bonagri/verification/kept-asset",
              fileName: "cipc.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
              createdAt: new Date(),
            },
          ],
        }),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "PENDING" }),
      );
      prisma.user.findUnique.mockResolvedValue({
        email: supplierUser.email,
        firstName: supplierUser.firstName,
      });

      const result = await service.resubmitApplication("vendor-1", "app-1", {
        ...baseDto,
        documents: [
          {
            kind: "BUSINESS_REGISTRATION",
            documentId: "doc-keep",
            fileName: "cipc.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
          },
        ],
      });

      expect(result).toMatchObject({ status: "PENDING" });
      const created =
        tx.verificationApplication.update.mock.calls[0][0].data.documents
          .create;
      expect(created).toEqual([
        {
          kind: "BUSINESS_REGISTRATION",
          publicId: "bonagri/verification/kept-asset",
          fileName: "cipc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        },
      ]);
      // A kept asset must not be destroyed during the swap.
      expect(media.destroyAsset).not.toHaveBeenCalled();
    });

    it("rejects a kept-document id that is not on this application", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({
          status: "ACTION_REQUIRED",
          documents: [],
        }),
      );

      const error = await service
        .resubmitApplication("vendor-1", "app-1", {
          ...baseDto,
          documents: [
            {
              kind: "BUSINESS_REGISTRATION",
              documentId: "someone-elses-row",
            },
          ],
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "INVALID_DOCUMENT",
      });
    });

    it("rejects a payload carrying both references for one document", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({ status: "ACTION_REQUIRED" }),
      );

      await expect(
        service.resubmitApplication("vendor-1", "app-1", {
          ...baseDto,
          documents: [
            {
              kind: "BUSINESS_REGISTRATION",
              publicId: "bonagri/verification/bbb12345",
              documentId: "doc-keep",
            },
          ],
        }),
      ).rejects.toThrow("Invalid document reference");
    });

    it("hides other users' applications behind a 404", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        applicationRow({ userId: "someone-else" }),
      );

      await expect(
        service.resubmitApplication("vendor-1", "app-1", baseDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("listMine / getMe", () => {
    it("returns the applicant's history without internal review notes", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findMany.mockResolvedValue([
        applicationRow({
          reviewNotes: "internal: check CIPC number twice",
          auditLogs: [
            {
              id: "log-1",
              action: "SUBMITTED",
              fromStatus: null,
              toStatus: "PENDING",
              reason: null,
              createdAt: new Date(),
            },
          ],
        }),
      ]);

      const result = await service.listMine("vendor-1");

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty("history");
      expect(JSON.stringify(result)).not.toContain("internal: check");
      expect(JSON.stringify(result)).not.toContain("bonagri/verification");
    });

    it("summarises phone and business state with pending OTP restore data", async () => {
      const { service, prisma } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        phone: "0821234567",
        phoneVerifiedAt: new Date("2026-10-01T00:00:00Z"),
        businessStatus: "NOT_STARTED",
        businessVerifiedAt: null,
        role: "BUYER",
        latestApplication: null,
        supplierProfile: null,
      });
      prisma.phoneOtpCode.findFirst.mockResolvedValue({
        phone: "0821234567",
        expiresAt: new Date("2026-11-09T10:00:00Z"),
      });

      const result = await service.getMe("buyer-1");

      expect(result.phone).toMatchObject({
        number: "0821234567",
        verified: true,
        pendingPhone: "0821234567",
      });
      expect(result.business).toMatchObject({
        status: "NOT_STARTED",
        badge: false,
      });
    });
  });

  describe("getDocumentUrl (owner-or-admin)", () => {
    it("serves the owner a signed URL", async () => {
      const { service, prisma, media } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue({
        userId: "vendor-1",
        documents: [
          { id: "doc-1", publicId: "bonagri/verification/aaa" },
        ],
      });
      media.signDeliveryUrl.mockReturnValue({
        url: "https://res.cloudinary.com/x/image/private/s--sig--/v1/bonagri/verification/aaa",
        expiresInSeconds: 300,
      });

      const result = await service.getDocumentUrl(
        { id: "vendor-1", role: "SUPPLIER" },
        "app-1",
        "doc-1",
      );

      expect(result.url).toContain("/image/private/");
      expect(result.expiresInSeconds).toBe(300);
      expect(media.signDeliveryUrl).toHaveBeenCalledWith(
        "bonagri/verification/aaa",
      );
    });

    it("404s for a different applicant (no existence probing)", async () => {
      const { service, prisma, media } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue({
        userId: "vendor-1",
        documents: [{ id: "doc-1", publicId: "bonagri/verification/aaa" }],
      });

      await expect(
        service.getDocumentUrl(
          { id: "intruder", role: "SUPPLIER" },
          "app-1",
          "doc-1",
        ),
      ).rejects.toThrow(NotFoundException);
      expect(media.signDeliveryUrl).not.toHaveBeenCalled();
    });

    it("serves an admin", async () => {
      const { service, prisma, media } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue({
        userId: "vendor-1",
        documents: [{ id: "doc-1", publicId: "bonagri/verification/aaa" }],
      });
      media.signDeliveryUrl.mockReturnValue({
        url: "https://res.cloudinary.com/x/image/private/s--sig--/v1/bonagri/verification/aaa",
        expiresInSeconds: null,
      });

      await expect(
        service.getDocumentUrl(
          { id: "admin-1", role: "ADMIN" },
          "app-1",
          "doc-1",
        ),
      ).resolves.toMatchObject({ url: expect.stringContaining("private") });
    });
  });
});

describe("VerificationService (CP17 admin review centre)", () => {
  const adminApplication = (overrides: Record<string, unknown> = {}) =>
    applicationRow({
      user: {
        id: "vendor-1",
        email: "vendor@bonagri.co.za",
        firstName: "Thandi",
      },
      ...overrides,
    });

  describe("adminAct", () => {
    it("approves from PENDING: status, summary, badge, audit and notification", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        adminApplication(),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "VERIFIED" }),
      );

      const result = await service.adminAct("app-1", "admin-1", {
        action: "approve",
      });

      expect(result).toMatchObject({ status: "VERIFIED" });
      expect(tx.verificationApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "VERIFIED",
            reviewedById: "admin-1",
            auditLogs: {
              create: expect.objectContaining({
                action: "APPROVED",
                adminId: "admin-1",
                toStatus: "VERIFIED",
              }),
            },
          }),
        }),
      );
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessStatus: "VERIFIED",
            businessVerifiedAt: expect.any(Date),
          }),
        }),
      );
      expect(tx.supplierProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { verified: true } }),
      );
      expect(notifications.onVerificationApproved).toHaveBeenCalled();
    });

    it("requires a meaningful reason for reject, request_info and suspend", async () => {
      const { service, prisma, tx } = makeService();

      for (const action of ["reject", "request_info", "suspend"] as const) {
        prisma.verificationApplication.findUnique.mockResolvedValue(
          adminApplication(
            action === "suspend" ? { status: "VERIFIED" } : {},
          ),
        );

        const error = await service
          .adminAct("app-1", "admin-1", { action, reason: "no" })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: "REASON_REQUIRED",
        });
      }

      expect(tx.verificationApplication.update).not.toHaveBeenCalled();
    });

    it("refuses illegal transitions (e.g. suspend a pending application)", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        adminApplication({ status: "PENDING" }),
      );

      const error = await service
        .adminAct("app-1", "admin-1", {
          action: "suspend",
          reason: "suspicious documents",
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "INVALID_TRANSITION",
        from: "PENDING",
      });
    });

    it("request_info stores the user-facing reason and notifies the applicant", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        adminApplication(),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "ACTION_REQUIRED" }),
      );

      await service.adminAct("app-1", "admin-1", {
        action: "request_info",
        reason: "Upload a legible CIPC certificate",
        notes: "blurry photo",
      });

      expect(tx.verificationApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ACTION_REQUIRED",
            infoRequest: "Upload a legible CIPC certificate",
          }),
        }),
      );
      expect(notifications.onVerificationInfoRequested).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        "Upload a legible CIPC certificate",
      );
    });

    it("suspend clears the badge and the verified timestamp", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        adminApplication({ status: "VERIFIED" }),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "SUSPENDED" }),
      );

      await service.adminAct("app-1", "admin-1", {
        action: "suspend",
        reason: "Document appears forged",
      });

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessStatus: "SUSPENDED",
            businessVerifiedAt: null,
          }),
        }),
      );
      expect(tx.supplierProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { verified: false } }),
      );
      expect(notifications.onVerificationSuspended).toHaveBeenCalled();
    });

    it("start_review moves PENDING to UNDER_REVIEW without notifying", async () => {
      const { service, prisma, tx, notifications } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(
        adminApplication(),
      );
      tx.verificationApplication.update.mockResolvedValue(
        applicationRow({ status: "UNDER_REVIEW" }),
      );

      await service.adminAct("app-1", "admin-1", { action: "start_review" });

      expect(tx.verificationApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNDER_REVIEW" }),
        }),
      );
      expect(notifications.onVerificationApproved).not.toHaveBeenCalled();
      expect(notifications.onVerificationRejected).not.toHaveBeenCalled();
    });

    it("rejects an unknown application id", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.adminAct("ghost", "admin-1", { action: "approve" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("adminList / adminStats", () => {
    it("paginates and filters the queue", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.findMany.mockResolvedValue([
        {
          ...applicationRow(),
          user: {
            id: "vendor-1",
            email: "vendor@bonagri.co.za",
            firstName: "Thandi",
            lastName: "Mokoena",
            role: "SUPPLIER",
            phone: null,
            phoneVerifiedAt: null,
            businessStatus: "PENDING",
            businessVerifiedAt: null,
          },
          documents: [{ id: "doc-1" }],
          reviewedBy: null,
        },
      ]);
      prisma.verificationApplication.count.mockResolvedValue(1);

      const result = await service.adminList({
        status: "PENDING",
        role: "SUPPLIER",
        take: 10,
        skip: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: "app-1",
        documentCount: 1,
        applicant: { email: "vendor@bonagri.co.za" },
      });
      expect(prisma.verificationApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            role: "SUPPLIER",
          }),
          skip: 10,
          take: 10,
        }),
      );
    });

    it("maps groupBy results into per-status counts", async () => {
      const { service, prisma } = makeService();

      prisma.verificationApplication.groupBy.mockResolvedValue([
        { status: "PENDING", _count: { _all: 3 } },
        { status: "REJECTED", _count: { _all: 1 } },
      ]);
      prisma.user.groupBy.mockResolvedValue([
        { businessStatus: "VERIFIED", _count: { _all: 5 } },
      ]);
      prisma.user.count.mockResolvedValue(7);

      const stats = await service.adminStats();

      expect(stats.applications.PENDING).toBe(3);
      expect(stats.applications.REJECTED).toBe(1);
      expect(stats.applications.UNDER_REVIEW).toBe(0);
      expect(stats.accounts.VERIFIED).toBe(5);
      expect(stats.phoneVerified).toBe(7);
    });
  });

  describe("syncLegacyBadge", () => {
    it("carries a legacy badge-on toggle into the centralised summary", async () => {
      const { service, prisma, tx } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        businessStatus: "NOT_STARTED",
        latestApplication: { id: "app-1", status: "PENDING" },
      });

      await service.syncLegacyBadge("vendor-1", true, "admin-1");

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ businessStatus: "VERIFIED" }),
        }),
      );
      expect(tx.verificationApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "VERIFIED",
            auditLogs: {
              create: expect.objectContaining({
                action: "APPROVED",
                reason: "Legacy supplier verify toggle",
              }),
            },
          }),
        }),
      );
    });

    it("is a no-op when turning an already-off badge off", async () => {
      const { service, prisma, tx } = makeService();

      prisma.user.findUnique.mockResolvedValue({
        businessStatus: "NOT_STARTED",
        latestApplication: null,
      });

      await service.syncLegacyBadge("vendor-1", false, "admin-1");

      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.supplierProfile.updateMany).not.toHaveBeenCalled();
    });
  });
});
