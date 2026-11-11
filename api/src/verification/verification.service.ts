import { createHash, randomInt } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MediaService } from "../media/media.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import type {
  UserRole,
  VerificationAction,
  VerificationDocumentKind,
  VerificationStatus,
} from "../common/types";
import {
  allowedDocumentKinds,
  getDocumentRequirements,
  requiredDocumentKinds,
} from "./document-requirements";
import type { AdminVerificationAction } from "./dto/admin-action.dto";
import type { AdminVerificationQueryDto } from "./dto/admin-query.dto";
import type {
  SubmitVerificationApplicationDto,
  VerificationDocumentDto,
} from "./dto/submit-application.dto";

// CP17: centralised user & business verification. Every status change in the
// system funnels through this service — applicants may only SUBMIT or
// RESUBMIT; approve/reject/request-info/suspend exist solely behind the
// ADMIN controller. `User.businessStatus` + `SupplierProfile.verified` are
// always written together with the application row so the public badge and
// the internal summary can never diverge.

const OTP_TTL_MS = 10 * 60_000; // code expiry
const OTP_RESEND_COOLDOWN_MS = 60_000; // per-user resend cooldown
const OTP_MAX_ATTEMPTS = 5; // wrong codes before the row locks
const OTP_PURGE_MS = 24 * 60 * 60_000; // expired rows are kept briefly for audit-ish debugging, then dropped on next send

// One live application per user at a time; resubmission paths are explicit.
const ACTIVE_APPLICATION_STATUSES: VerificationStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "ACTION_REQUIRED",
];

const ALLOWED_DOCUMENT_MIME =
  /^(image\/(jpeg|png|webp|avif)|application\/pdf)$/;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

// Admin action → validated transition. Nothing outside this table can move
// an application through review.
const ADMIN_TRANSITIONS: Record<
  AdminVerificationAction,
  {
    to: VerificationStatus;
    allowedFrom: VerificationStatus[];
    requiresReason: boolean;
    auditAction: VerificationAction;
  }
> = {
  start_review: {
    to: "UNDER_REVIEW",
    allowedFrom: ["PENDING"],
    requiresReason: false,
    auditAction: "STARTED_REVIEW",
  },
  approve: {
    to: "VERIFIED",
    allowedFrom: ["PENDING", "UNDER_REVIEW", "ACTION_REQUIRED", "SUSPENDED"],
    requiresReason: false,
    auditAction: "APPROVED",
  },
  reject: {
    to: "REJECTED",
    allowedFrom: ["PENDING", "UNDER_REVIEW", "ACTION_REQUIRED"],
    requiresReason: true,
    auditAction: "REJECTED",
  },
  request_info: {
    to: "ACTION_REQUIRED",
    allowedFrom: ["PENDING", "UNDER_REVIEW"],
    requiresReason: true,
    auditAction: "INFO_REQUESTED",
  },
  suspend: {
    to: "SUSPENDED",
    allowedFrom: ["VERIFIED"],
    requiresReason: true,
    auditAction: "SUSPENDED",
  },
};

type ApplicantRecipient = { id: string; email: string; firstName: string };

type ApplicationDocumentInput = {
  kind: VerificationDocumentKind;
  publicId: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
};

function hashOtp(userId: string, code: string): string {
  // Salted per user: a leaked hash from one account cannot verify another.
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

function normalizePhone(input: string): string {
  return input.replace(/[^\d+]/g, "");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) {
    return email;
  }
  const head = local.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

// Json column → the shape the requirement builder understands (nothing else
// from the payload is ever read here).
function asDetails(value: unknown): { licenceCategories?: unknown } | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as { licenceCategories?: unknown };
  }
  return null;
}

function sanitizeDetails(
  role: UserRole,
  raw: Record<string, unknown> | undefined,
): { licenceCategories: string[] } | null {
  if (!raw || (role !== "SUPPLIER" && role !== "AGRO_DEALER")) {
    return null;
  }

  // Only known, size-bounded keys ever reach the Json column.
  if (!Array.isArray(raw.licenceCategories)) {
    return null;
  }

  const categories = [
    ...new Set(
      raw.licenceCategories
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 20),
    ),
  ];

  return categories.length ? { licenceCategories: categories } : null;
}

// Safe projection for the applicant: their own data, never internal notes.
function toApplicantView(
  app: {
    id: string;
    userId: string;
    role: string;
    status: VerificationStatus;
    businessName: string;
    registrationNumber: string | null;
    contactPhone: string;
    contactEmail: string | null;
    physicalAddress: string;
    representativeName: string;
    details: unknown;
    submittedAt: Date;
    updatedAt: Date;
    reviewedAt: Date | null;
    rejectionReason: string | null;
    infoRequest: string | null;
    documents: Array<{
      id: string;
      kind: VerificationDocumentKind;
      fileName: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
      createdAt: Date;
    }>;
    auditLogs?: Array<{
      id: string;
      action: VerificationAction;
      fromStatus: VerificationStatus | null;
      toStatus: VerificationStatus | null;
      reason: string | null;
      createdAt: Date;
    }>;
  },
  includeAudit = false,
) {
  return {
    id: app.id,
    role: app.role,
    status: app.status,
    businessName: app.businessName,
    registrationNumber: app.registrationNumber,
    contactPhone: app.contactPhone,
    contactEmail: app.contactEmail,
    physicalAddress: app.physicalAddress,
    representativeName: app.representativeName,
    details: app.details ?? null,
    submittedAt: app.submittedAt,
    updatedAt: app.updatedAt,
    reviewedAt: app.reviewedAt,
    rejectionReason: app.rejectionReason,
    infoRequest: app.infoRequest,
    documents: app.documents.map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt,
    })),
    ...(includeAudit && app.auditLogs
      ? {
          history: app.auditLogs.map((entry) => ({
            id: entry.id,
            action: entry.action,
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            reason: entry.reason,
            createdAt: entry.createdAt,
          })),
        }
      : {}),
  };
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------
  // Safe summary (GET /verification/me)
  // ------------------------------------------------------------------
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        phoneVerifiedAt: true,
        businessStatus: true,
        businessVerifiedAt: true,
        role: true,
        latestApplication: {
          select: {
            id: true,
            status: true,
            businessName: true,
            role: true,
            submittedAt: true,
            updatedAt: true,
            rejectionReason: true,
            infoRequest: true,
          },
        },
        supplierProfile: {
          select: { businessName: true, verified: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }

    const pending = await this.prisma.phoneOtpCode.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { phone: true, expiresAt: true },
    });

    return {
      phone: {
        number: user.phone,
        verified: user.phoneVerifiedAt !== null,
        verifiedAt: user.phoneVerifiedAt,
        // So the OTP screen can restore its state after a reload.
        pendingPhone: pending?.phone ?? null,
        pendingExpiresAt: pending?.expiresAt ?? null,
      },
      business: {
        status: user.businessStatus,
        verifiedAt: user.businessVerifiedAt,
        badge: user.supplierProfile?.verified ?? false,
        businessName: user.supplierProfile?.businessName ?? null,
        latestApplication: user.latestApplication ?? null,
        requirements: getDocumentRequirements(user.role, null),
      },
    };
  }

  // ------------------------------------------------------------------
  // Buyer phone OTP (email is the trusted channel — no SMS provider here)
  // ------------------------------------------------------------------
  async sendPhoneOtp(userId: string, phoneInput: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, role: true },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }

    if (user.role !== "BUYER") {
      throw new BadRequestException(
        "Only buyer accounts verify a phone number",
      );
    }

    const phone = normalizePhone(phoneInput);
    if (phone.length < 7 || phone.length > 16) {
      throw new BadRequestException("Enter a valid phone number");
    }

    const now = new Date();
    const live = await this.prisma.phoneOtpCode.findFirst({
      where: { userId, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (live) {
      const ageMs = now.getTime() - live.createdAt.getTime();
      if (ageMs < OTP_RESEND_COOLDOWN_MS) {
        const retryInSeconds = Math.ceil(
          (OTP_RESEND_COOLDOWN_MS - ageMs) / 1000,
        );
        throw new HttpException(
          {
            message: `Please wait ${retryInSeconds} seconds before requesting a new code`,
            code: "OTP_COOLDOWN",
            retryInSeconds,
          },
          429,
        );
      }
    }

    // Single live code: requesting again invalidates the previous one (no
    // parallel attempts), and rows older than a day are purged opportunistically.
    await this.prisma.$transaction([
      this.prisma.phoneOtpCode.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.phoneOtpCode.deleteMany({
        where: { userId, expiresAt: { lt: new Date(now.getTime() - OTP_PURGE_MS) } },
      }),
    ]);

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const row = await this.prisma.phoneOtpCode.create({
      data: {
        userId,
        phone,
        codeHash: hashOtp(userId, code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      },
      select: { id: true },
    });

    try {
      await this.mail.sendPhoneOtpEmail(user.email, user.firstName, code, phone);
    } catch (error) {
      // The code never reached the applicant — do not leave it live.
      await this.prisma.phoneOtpCode.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      console.error("BonAgri OTP delivery failed:", error);
      throw new ServiceUnavailableException(
        "We could not send your verification code. Please try again in a moment.",
      );
    }

    return {
      sent: true,
      phone,
      destination: maskEmail(user.email),
      expiresInSeconds: OTP_TTL_MS / 1000,
      resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    };
  }

  async confirmPhoneOtp(userId: string, code: string) {
    const now = new Date();
    const rows = await this.prisma.phoneOtpCode.findMany({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const candidate = rows.find((row) => row.expiresAt > now);

    if (!candidate) {
      if (rows.length > 0) {
        throw new BadRequestException({
          message: "That code has expired. Request a new one.",
          code: "OTP_EXPIRED",
        });
      }
      throw new BadRequestException({
        message: "No verification code is pending. Request a new one.",
        code: "OTP_NOT_REQUESTED",
      });
    }

    if (candidate.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.phoneOtpCode.update({
        where: { id: candidate.id },
        data: { consumedAt: now },
      });
      throw new BadRequestException({
        message: "Too many incorrect attempts. Request a new code.",
        code: "OTP_LOCKED",
      });
    }

    if (hashOtp(userId, code) !== candidate.codeHash) {
      const updated = await this.prisma.phoneOtpCode.update({
        where: { id: candidate.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);

      if (remaining === 0) {
        await this.prisma.phoneOtpCode.update({
          where: { id: candidate.id },
          data: { consumedAt: new Date() },
        });
      }

      throw new BadRequestException({
        message:
          remaining > 0
            ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Too many incorrect attempts. Request a new code.",
        code: remaining > 0 ? "OTP_INVALID" : "OTP_LOCKED",
        attemptsRemaining: remaining,
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phoneVerifiedAt: true, email: true, firstName: true },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }

    // Success consumes every live code (no replay) and records the number
    // that was actually confirmed. Re-verifying a new number keeps the
    // original verifiedAt timestamp.
    await this.prisma.$transaction([
      this.prisma.phoneOtpCode.update({
        where: { id: candidate.id },
        data: { consumedAt: now },
      }),
      this.prisma.phoneOtpCode.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          phone: candidate.phone,
          phoneVerifiedAt: user.phoneVerifiedAt ?? now,
        },
      }),
    ]);

    try {
      await this.notifications.onPhoneVerified({
        id: userId,
        email: user.email,
        firstName: user.firstName,
      });
    } catch (error) {
      console.error("BonAgri phone verification notification failed:", error);
    }

    return { verified: true, phone: candidate.phone };
  }

  // ------------------------------------------------------------------
  // Business applications (supplier / agro-dealer)
  // ------------------------------------------------------------------
  async submitApplication(
    userId: string,
    dto: SubmitVerificationApplicationDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        email: true,
        firstName: true,
        businessStatus: true,
        latestApplication: { select: { id: true, status: true } },
      },
    });

    if (!user) {
      throw new NotFoundException("Account not found");
    }

    if (user.role !== "SUPPLIER" && user.role !== "AGRO_DEALER") {
      throw new ForbiddenException(
        "Only supplier and agro-dealer accounts submit business verification",
      );
    }

    if (
      user.businessStatus === "VERIFIED" ||
      user.businessStatus === "SUSPENDED"
    ) {
      throw new ConflictException({
        message:
          user.businessStatus === "VERIFIED"
            ? "This account is already business verified"
            : "This account's verification is suspended — contact the BonAgri team",
        code: "VERIFICATION_NOT_RESUBMITTABLE",
        businessStatus: user.businessStatus,
      });
    }

    const latest = user.latestApplication;
    if (latest && ACTIVE_APPLICATION_STATUSES.includes(latest.status)) {
      throw new ConflictException({
        message: "You already have a verification application in progress",
        code: "APPLICATION_EXISTS",
        applicationId: latest.id,
        status: latest.status,
      });
    }
    if (latest && latest.status !== "REJECTED") {
      // VERIFIED/SUSPENDED applications without a matching summary can only
      // come from outside this flow — refuse rather than open a second track.
      throw new ConflictException({
        message: "You already have a verification application on file",
        code: "APPLICATION_EXISTS",
        applicationId: latest.id,
        status: latest.status,
      });
    }

    const details = sanitizeDetails(user.role, dto.details);
    const documents = this.validateDocuments(user.role, details, dto.documents);

    const application = await this.prisma.$transaction(async (tx) => {
      const created = await tx.verificationApplication.create({
        data: {
          userId: user.id,
          role: user.role,
          status: "PENDING",
          businessName: dto.businessName.trim(),
          registrationNumber: dto.registrationNumber?.trim() || null,
          contactPhone: normalizePhone(dto.contactPhone),
          contactEmail: dto.contactEmail?.trim() || null,
          physicalAddress: dto.physicalAddress.trim(),
          representativeName: dto.representativeName.trim(),
          ...(details ? { details } : {}),
          documents: {
            create: documents.map((doc) => ({ ...doc })),
          },
          auditLogs: {
            create: {
              userId: user.id,
              adminId: user.id,
              action: latest ? "RESUBMITTED" : "SUBMITTED",
              fromStatus: latest?.status ?? null,
              toStatus: "PENDING",
            },
          },
        },
        include: {
          documents: { orderBy: { createdAt: "asc" as const } },
        },
      });

      await this.syncSummary(tx, user.id, "PENDING", new Date());
      return created;
    });

    try {
      await this.notifications.onVerificationSubmitted(
        { id: user.id, email: user.email, firstName: user.firstName },
        application.businessName,
        Boolean(latest),
      );
    } catch (error) {
      console.error("BonAgri verification notification failed:", error);
    }

    return toApplicantView(application);
  }

  // Corrections-only resubmission: the SAME application goes back to
  // PENDING with new documents; the previous decision stays in the audit log.
  async resubmitApplication(
    userId: string,
    applicationId: string,
    dto: SubmitVerificationApplicationDto,
  ) {
    const existing = await this.prisma.verificationApplication.findUnique({
      where: { id: applicationId },
      include: { documents: true },
    });

    if (!existing || existing.userId !== userId) {
      throw new NotFoundException("Application not found");
    }

    if (existing.role !== "SUPPLIER" && existing.role !== "AGRO_DEALER") {
      // Unreachable for rows created through this service; guards the
      // narrowed role type below.
      throw new ForbiddenException("Invalid application");
    }

    if (existing.status !== "ACTION_REQUIRED") {
      throw new ConflictException({
        message:
          "Only applications that requested changes can be resubmitted",
        code: "RESUBMIT_NOT_ALLOWED",
        status: existing.status,
      });
    }

    const details = sanitizeDetails(existing.role, dto.details);
    const documents = this.validateDocuments(
      existing.role,
      details,
      dto.documents,
      existing.documents,
    );
    const removedPublicIds = existing.documents
      .map((doc) => doc.publicId)
      .filter((publicId) => !documents.some((doc) => doc.publicId === publicId));

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.verificationApplication.update({
        where: { id: applicationId },
        data: {
          businessName: dto.businessName.trim(),
          registrationNumber: dto.registrationNumber?.trim() || null,
          contactPhone: normalizePhone(dto.contactPhone),
          contactEmail: dto.contactEmail?.trim() || null,
          physicalAddress: dto.physicalAddress.trim(),
          representativeName: dto.representativeName.trim(),
          details: details ?? Prisma.DbNull,
          status: "PENDING",
          infoRequest: null,
          rejectionReason: null,
          reviewNotes: null,
          reviewedAt: null,
          reviewedById: null,
          submittedAt: new Date(),
          documents: {
            deleteMany: {},
            create: documents.map((doc) => ({ ...doc })),
          },
          auditLogs: {
            create: {
              userId,
              adminId: userId,
              action: "RESUBMITTED",
              fromStatus: "ACTION_REQUIRED",
              toStatus: "PENDING",
            },
          },
        },
        include: {
          documents: { orderBy: { createdAt: "asc" as const } },
        },
      });

      await this.syncSummary(tx, userId, "PENDING", new Date());
      return row;
    });

    // Replaced assets are only cleaned up after the row is safely updated
    // (best-effort, same house pattern as product image swaps).
    for (const publicId of removedPublicIds) {
      await this.media.destroyAsset(publicId);
    }

    try {
      const owner = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true },
      });
      if (owner) {
        await this.notifications.onVerificationSubmitted(
          { id: userId, ...owner },
          updated.businessName,
          true,
        );
      }
    } catch (error) {
      console.error("BonAgri verification notification failed:", error);
    }

    return toApplicantView(updated);
  }

  async listMine(userId: string) {
    const applications = await this.prisma.verificationApplication.findMany({
      where: { userId },
      orderBy: { submittedAt: "desc" },
      include: {
        documents: { orderBy: { createdAt: "asc" as const } },
        auditLogs: { orderBy: { createdAt: "asc" as const } },
      },
    });

    return {
      items: applications.map((app) => toApplicantView(app, true)),
    };
  }

  // Owner-or-admin private document access. Deliberately 404 (not 403) for
  // strangers so application ids cannot be probed.
  async getDocumentUrl(
    requester: { id: string; role: UserRole },
    applicationId: string,
    documentId: string,
  ) {
    const application = await this.prisma.verificationApplication.findUnique({
      where: { id: applicationId },
      select: {
        userId: true,
        documents: { where: { id: documentId } },
      },
    });

    const isOwner = application?.userId === requester.id;
    if (!application || (!isOwner && requester.role !== "ADMIN")) {
      throw new NotFoundException("Application not found");
    }

    const document = application.documents[0];
    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const { url, expiresInSeconds } = this.media.signDeliveryUrl(
      document.publicId,
    );

    return {
      url,
      expiresInSeconds,
      fileName: document.fileName,
      mimeType: document.mimeType,
    };
  }

  // ------------------------------------------------------------------
  // Admin review centre
  // ------------------------------------------------------------------
  async adminList(query: AdminVerificationQueryDto) {
    const take = query.take ?? 20;
    const skip = query.skip ?? 0;
    const q = query.q?.trim();

    const where: Prisma.VerificationApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.submittedFrom
        ? { submittedAt: { gte: new Date(`${query.submittedFrom}T00:00:00`) } }
        : {}),
      ...(q
        ? {
            OR: [
              { businessName: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { user: { email: { contains: q, mode: Prisma.QueryMode.insensitive } } },
              { user: { firstName: { contains: q, mode: Prisma.QueryMode.insensitive } } },
              { id: q },
              { userId: q },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.verificationApplication.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip,
        take,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              phone: true,
              phoneVerifiedAt: true,
              businessStatus: true,
              businessVerifiedAt: true,
            },
          },
          documents: { select: { id: true } },
          reviewedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.verificationApplication.count({ where }),
    ]);

    return {
      items: items.map((app) => ({
        id: app.id,
        status: app.status,
        role: app.role,
        businessName: app.businessName,
        submittedAt: app.submittedAt,
        updatedAt: app.updatedAt,
        documentCount: app.documents.length,
        reviewedBy: app.reviewedBy
          ? `${app.reviewedBy.firstName} ${app.reviewedBy.lastName}`
          : null,
        applicant: {
          id: app.user.id,
          email: app.user.email,
          name: `${app.user.firstName} ${app.user.lastName}`,
          role: app.user.role,
          phone: app.user.phone,
          phoneVerifiedAt: app.user.phoneVerifiedAt,
          businessStatus: app.user.businessStatus,
          businessVerifiedAt: app.user.businessVerifiedAt,
        },
      })),
      total,
      skip,
      take,
    };
  }

  async adminGet(applicationId: string) {
    const app = await this.prisma.verificationApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            phone: true,
            phoneVerifiedAt: true,
            businessStatus: true,
            businessVerifiedAt: true,
            createdAt: true,
            supplierProfile: {
              select: { businessName: true, verified: true, registrationNo: true },
            },
          },
        },
        reviewedBy: { select: { firstName: true, lastName: true } },
        documents: { orderBy: { createdAt: "asc" as const } },
        auditLogs: {
          orderBy: { createdAt: "asc" as const },
          include: {
            admin: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!app) {
      throw new NotFoundException("Application not found");
    }

    return {
      ...toApplicantView(app, true),
      // Internal notes are admin-only and never reach the applicant view.
      reviewNotes: app.reviewNotes,
      reviewedBy: app.reviewedBy
        ? `${app.reviewedBy.firstName} ${app.reviewedBy.lastName}`
        : null,
      requirements: getDocumentRequirements(app.role, asDetails(app.details)),
      applicant: {
        id: app.user.id,
        email: app.user.email,
        name: `${app.user.firstName} ${app.user.lastName}`,
        role: app.user.role,
        phone: app.user.phone,
        phoneVerifiedAt: app.user.phoneVerifiedAt,
        businessStatus: app.user.businessStatus,
        businessVerifiedAt: app.user.businessVerifiedAt,
        createdAt: app.user.createdAt,
        supplierProfile: app.user.supplierProfile,
      },
      history: (app.auditLogs ?? []).map((entry) => ({
        id: entry.id,
        action: entry.action,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        createdAt: entry.createdAt,
        actor: `${entry.admin.firstName} ${entry.admin.lastName}`,
      })),
    };
  }

  async adminStats() {
    const [applicationGroups, accountGroups, phoneVerified] =
      await this.prisma.$transaction([
        this.prisma.verificationApplication.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        this.prisma.user.groupBy({
          by: ["businessStatus"],
          _count: { _all: true },
        }),
        this.prisma.user.count({
          where: { phoneVerifiedAt: { not: null } },
        }),
      ]);

    const emptyStatuses: Record<VerificationStatus, number> = {
      NOT_STARTED: 0,
      PENDING: 0,
      UNDER_REVIEW: 0,
      ACTION_REQUIRED: 0,
      VERIFIED: 0,
      REJECTED: 0,
      SUSPENDED: 0,
    };

    const applications = { ...emptyStatuses };
    for (const group of applicationGroups) {
      applications[group.status] = group._count._all;
    }

    const accounts = { ...emptyStatuses };
    for (const group of accountGroups) {
      accounts[group.businessStatus] = group._count._all;
    }

    return { applications, accounts, phoneVerified };
  }

  async adminAct(
    applicationId: string,
    adminId: string,
    dto: {
      action: AdminVerificationAction;
      reason?: string;
      notes?: string;
    },
  ) {
    const config = ADMIN_TRANSITIONS[dto.action];
    const application = await this.prisma.verificationApplication.findUnique({
      where: { id: applicationId },
      include: {
        user: { select: { id: true, email: true, firstName: true } },
      },
    });

    if (!application) {
      throw new NotFoundException("Application not found");
    }

    if (!config.allowedFrom.includes(application.status)) {
      throw new ConflictException({
        message: `Cannot ${dto.action.replace("_", " ")} an application that is ${application.status}`,
        code: "INVALID_TRANSITION",
        from: application.status,
        allowedFrom: config.allowedFrom,
      });
    }

    const reason = dto.reason?.trim();
    if (config.requiresReason && (!reason || reason.length < 5)) {
      throw new BadRequestException({
        message:
          "A meaningful reason is required for this action — the applicant is shown this text.",
        code: "REASON_REQUIRED",
      });
    }

    const now = new Date();
    const next = config.to;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.verificationApplication.update({
        where: { id: applicationId },
        data: {
          status: next,
          reviewedAt: now,
          reviewedById: adminId,
          ...(dto.notes?.trim() ? { reviewNotes: dto.notes.trim() } : {}),
          ...(dto.action === "reject"
            ? { rejectionReason: reason ?? null, infoRequest: null }
            : {}),
          ...(dto.action === "request_info"
            ? { infoRequest: reason ?? null, rejectionReason: null }
            : {}),
          ...(next === "VERIFIED"
            ? { rejectionReason: null, infoRequest: null }
            : {}),
          auditLogs: {
            create: {
              userId: application.userId,
              adminId,
              action: config.auditAction,
              fromStatus: application.status,
              toStatus: next,
              reason: reason ?? null,
            },
          },
        },
        include: {
          documents: { orderBy: { createdAt: "asc" as const } },
        },
      });

      await this.syncSummary(tx, application.userId, next, now);
      return row;
    });

    const recipient: ApplicantRecipient = {
      id: application.user.id,
      email: application.user.email,
      firstName: application.user.firstName,
    };

    try {
      switch (dto.action) {
        case "approve":
          await this.notifications.onVerificationApproved(
            recipient,
            application.businessName,
          );
          break;
        case "reject":
          await this.notifications.onVerificationRejected(
            recipient,
            application.businessName,
            reason ?? "",
          );
          break;
        case "request_info":
          await this.notifications.onVerificationInfoRequested(
            recipient,
            application.businessName,
            reason ?? "",
          );
          break;
        case "suspend":
          await this.notifications.onVerificationSuspended(
            recipient,
            application.businessName,
            reason ?? "",
          );
          break;
        default:
          // start_review: no notification (the queue moved, nothing to act on).
          break;
      }
    } catch (error) {
      console.error("BonAgri verification notification failed:", error);
    }

    return toApplicantView(updated);
  }

  // ------------------------------------------------------------------
  // Shared sync helpers
  // ------------------------------------------------------------------

  // The ONLY writer of the public summary + badge. Called inside whatever
  // transaction performs the status change, so the three records
  // (application, User summary, SupplierProfile badge) commit together.
  async syncSummary(
    tx: Prisma.TransactionClient,
    userId: string,
    status: VerificationStatus,
    now: Date,
  ) {
    await tx.user.update({
      where: { id: userId },
      data: {
        businessStatus: status,
        ...(status === "VERIFIED"
          ? { businessVerifiedAt: now }
          : status === "SUSPENDED"
            ? { businessVerifiedAt: null }
            : {}),
      },
    });

    // Badge mirrors the summary: granted on VERIFIED, cleared everywhere else.
    await tx.supplierProfile.updateMany({
      where: { userId },
      data: { verified: status === "VERIFIED" },
    });
  }

  // The legacy admin "verified" toggle on the suppliers screen now routes
  // through the same summary sync so it can never disagree with
  // User.businessStatus. If the account has an application, its status and
  // audit trail follow along (only when the transition is legal).
  async syncLegacyBadge(
    userId: string,
    verified: boolean,
    adminId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        businessStatus: true,
        latestApplication: {
          select: { id: true, status: true, businessName: true },
        },
      },
    });

    if (!user) {
      return;
    }

    const next: VerificationStatus = verified
      ? "VERIFIED"
      : user.businessStatus === "VERIFIED"
        ? "SUSPENDED"
        : user.businessStatus;

    if (next === user.businessStatus && verified === false) {
      // Badge already off and summary not VERIFIED — nothing to sync.
      return;
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await this.syncSummary(tx, userId, next, now);

      const application = user.latestApplication;
      if (application && application.status !== next) {
        const legal =
          next === "VERIFIED"
            ? ADMIN_TRANSITIONS.approve.allowedFrom.includes(application.status)
            : next === "SUSPENDED" &&
              ADMIN_TRANSITIONS.suspend.allowedFrom.includes(application.status);

        if (legal) {
          await tx.verificationApplication.update({
            where: { id: application.id },
            data: {
              status: next,
              reviewedAt: now,
              reviewedById: adminId,
              auditLogs: {
                create: {
                  userId,
                  adminId,
                  action:
                    next === "VERIFIED" ? "APPROVED" : "SUSPENDED",
                  fromStatus: application.status,
                  toStatus: next,
                  reason: "Legacy supplier verify toggle",
                },
              },
            },
          });
        }
      }
    });
  }

  // ------------------------------------------------------------------
  // Validation helpers
  // ------------------------------------------------------------------
  private validateDocuments(
    role: "SUPPLIER" | "AGRO_DEALER",
    details: { licenceCategories: string[] } | null,
    documents: VerificationDocumentDto[],
    // Rows already on the application being resubmitted. A payload may keep
    // those by row id (documentId) instead of re-uploading — the stored
    // publicId never travels to the client.
    retained?: Array<{
      id: string;
      kind: VerificationDocumentKind;
      publicId: string;
      fileName: string | null;
      mimeType: string | null;
      sizeBytes: number | null;
    }>,
  ): ApplicationDocumentInput[] {
    if (!documents || documents.length === 0) {
      throw new BadRequestException({
        message: "Attach the required business documents",
        code: "DOCUMENTS_REQUIRED",
      });
    }

    const allowed = allowedDocumentKinds(role);
    const required = requiredDocumentKinds(role, details);
    const seen = new Set<VerificationDocumentKind>();
    const retainedById = new Map((retained ?? []).map((row) => [row.id, row]));

    for (const doc of documents) {
      if (!allowed.includes(doc.kind)) {
        throw new BadRequestException({
          message: "That document type is not accepted for this account",
          code: "INVALID_DOCUMENT",
        });
      }

      if (seen.has(doc.kind)) {
        throw new BadRequestException({
          message:
            "Only one document per type — replace the existing one instead of adding a duplicate",
          code: "DUPLICATE_DOCUMENT",
          kind: doc.kind,
        });
      }
      seen.add(doc.kind);

      // Exactly one reference: a fresh upload, or a row of THIS application
      // kept from the previous submission.
      if (doc.publicId && doc.documentId) {
        throw new BadRequestException({
          message: "Invalid document reference",
          code: "INVALID_DOCUMENT",
        });
      }

      if (doc.documentId) {
        const row = retainedById.get(doc.documentId);
        // Unknown id, or a kind swap under a kept id — both mean the payload
        // is not describing the application it claims to.
        if (!row || row.kind !== doc.kind) {
          throw new BadRequestException({
            message: "Invalid document reference",
            code: "INVALID_DOCUMENT",
          });
        }
        continue;
      }

      // Defence in depth: the DTO regex enforces this on the HTTP path, and
      // the service re-checks so a crafted internal call cannot reference
      // assets outside our private verification folder.
      if (
        !doc.publicId ||
        !doc.publicId.startsWith("bonagri/verification/") ||
        !/^bonagri\/verification\/[A-Za-z0-9_-]{8,128}$/.test(doc.publicId)
      ) {
        throw new BadRequestException({
          message: "Invalid document reference",
          code: "INVALID_DOCUMENT",
        });
      }

      if (doc.mimeType && !ALLOWED_DOCUMENT_MIME.test(doc.mimeType)) {
        throw new BadRequestException({
          message: "Documents must be JPEG, PNG, WebP, AVIF images or PDFs",
          code: "INVALID_DOCUMENT",
          kind: doc.kind,
        });
      }

      if (doc.sizeBytes && doc.sizeBytes > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException({
          message: "Each document must be 5 MB or smaller",
          code: "INVALID_DOCUMENT",
          kind: doc.kind,
        });
      }
    }

    const missing = required.filter((kind) => !seen.has(kind));
    if (missing.length > 0) {
      const built = getDocumentRequirements(role, details);
      const labels = built
        ? missing.map(
            (kind) =>
              built.requirements.find((req) => req.kind === kind)?.label ??
              kind,
            )
        : missing;

      throw new BadRequestException({
        message: `Missing required document(s): ${labels.join(", ")}`,
        code: "MISSING_REQUIRED_DOCUMENTS",
        missing,
      });
    }

    return documents.map((doc) => {
      if (doc.documentId) {
        const row = retainedById.get(doc.documentId)!;
        return {
          kind: row.kind,
          publicId: row.publicId,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
        };
      }

      return {
        kind: doc.kind,
        publicId: doc.publicId!,
        fileName: doc.fileName ?? null,
        mimeType: doc.mimeType ?? null,
        sizeBytes: doc.sizeBytes ?? null,
      };
    });
  }
}
