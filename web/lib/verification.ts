// CP17: typed client for the centralised verification API. One module so
// every screen (buyer OTP card, supplier Verification Centre, admin review
// centre) speaks the same endpoints and error codes.
import { authHeaders } from "./auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// Machine-readable codes thrown by api/src/verification/verification.permissions.ts
// — the UI routes on these, not on message text.
export const VERIFICATION_CODES = {
  PHONE_REQUIRED: "PHONE_VERIFICATION_REQUIRED",
  BUSINESS_REQUIRED: "BUSINESS_VERIFICATION_REQUIRED",
} as const;

export type VerificationStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

export type VerificationDocumentKind =
  | "BUSINESS_REGISTRATION"
  | "BUSINESS_LICENCE"
  | "AGRICULTURAL_INPUT_LICENCE"
  | "PROOF_OF_BUSINESS_ADDRESS"
  | "OWNER_ID"
  | "OTHER";

export type VerificationDocument = {
  id: string;
  kind: VerificationDocumentKind;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type DocumentRequirement = {
  kind: VerificationDocumentKind;
  label: string;
  why: string;
  required: boolean;
};

export type VerificationSummary = {
  phone: {
    number: string | null;
    verified: boolean;
    verifiedAt: string | null;
    pendingPhone: string | null;
    pendingExpiresAt: string | null;
  };
  business: {
    status: VerificationStatus;
    verifiedAt: string | null;
    badge: boolean;
    businessName: string | null;
    latestApplication: {
      id: string;
      status: VerificationStatus;
      businessName: string;
      rejectionReason: string | null;
      infoRequest: string | null;
    } | null;
    requirements: { role: string; requirements: DocumentRequirement[] } | null;
  };
};

export type ApplicationPayload = {
  businessName: string;
  registrationNumber?: string;
  contactPhone: string;
  contactEmail?: string;
  physicalAddress: string;
  representativeName: string;
  details?: Record<string, unknown>;
  documents: Array<{
    kind: VerificationDocumentKind;
    /** Fresh upload reference (from uploadVerificationDocument) … */
    publicId?: string;
    /** … or a row of this application kept from the previous submission. */
    documentId?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
};

// API errors carry { message, code } — preserve the code so callers can
// branch (e.g. OTP_COOLDOWN vs OTP_INVALID).
export class VerificationApiError extends Error {
  readonly code: string | null;
  readonly status: number;
  /** Present on OTP_COOLDOWN responses — seconds until a resend is allowed. */
  readonly retryInSeconds: number | null;

  constructor(
    message: string,
    code: string | null,
    status: number,
    retryInSeconds: number | null = null,
  ) {
    super(message);
    this.name = "VerificationApiError";
    this.code = code;
    this.status = status;
    this.retryInSeconds = retryInSeconds;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const data = (await response.json().catch(() => null)) as {
    message?: string | string[];
    code?: string;
    retryInSeconds?: number;
  } | null;

  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new VerificationApiError(
      message || "Verification request failed — try again.",
      data?.code ?? null,
      response.status,
      typeof data?.retryInSeconds === "number" ? data.retryInSeconds : null,
    );
  }

  return data as T;
}

export function getVerificationSummary(): Promise<VerificationSummary> {
  return request<VerificationSummary>("/verification/me");
}

export function sendPhoneOtp(phone: string): Promise<{
  sent: boolean;
  phone: string;
  destination: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}> {
  return request("/verification/phone/send", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export function confirmPhoneOtp(code: string): Promise<{
  verified: boolean;
  phone: string;
}> {
  return request("/verification/phone/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function submitApplication(
  payload: ApplicationPayload,
): Promise<{ id: string; status: VerificationStatus }> {
  return request("/verification/applications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type OwnApplication = {
  id: string;
  role: string;
  status: VerificationStatus;
  businessName: string;
  registrationNumber: string | null;
  contactPhone: string;
  contactEmail: string | null;
  physicalAddress: string;
  representativeName: string;
  details: unknown;
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  infoRequest: string | null;
  documents: VerificationDocument[];
  history?: Array<{
    id: string;
    action: string;
    fromStatus: VerificationStatus | null;
    toStatus: VerificationStatus | null;
    reason: string | null;
    createdAt: string;
  }>;
};

export function listMyApplications(): Promise<{ items: OwnApplication[] }> {
  return request("/verification/applications/mine");
}

export function resubmitApplication(
  applicationId: string,
  payload: ApplicationPayload,
): Promise<{ id: string; status: VerificationStatus }> {
  return request(`/verification/applications/${applicationId}/resubmit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Short-lived signed link for a private document (owner or admin only).
export function getDocumentUrl(
  applicationId: string,
  documentId: string,
): Promise<{ url: string; expiresInSeconds: number | null }> {
  return request(
    `/verification/applications/${applicationId}/documents/${documentId}`,
  );
}

// ---------------------------------------------------------------- admin ---

export type AdminApplicationListItem = {
  id: string;
  status: VerificationStatus;
  role: "SUPPLIER" | "AGRO_DEALER";
  businessName: string;
  submittedAt: string;
  updatedAt: string;
  documentCount: number;
  reviewedBy: string | null;
  applicant: {
    id: string;
    email: string;
    name: string;
    role: string;
    phone: string | null;
    phoneVerifiedAt: string | null;
    businessStatus: VerificationStatus;
    businessVerifiedAt: string | null;
  };
};

export type AdminApplicationDetail = {
  id: string;
  status: VerificationStatus;
  role: "SUPPLIER" | "AGRO_DEALER";
  businessName: string;
  registrationNumber: string | null;
  contactPhone: string;
  contactEmail: string | null;
  physicalAddress: string;
  representativeName: string;
  details: unknown;
  submittedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  rejectionReason: string | null;
  infoRequest: string | null;
  documents: VerificationDocument[];
  requirements: { role: string; requirements: DocumentRequirement[] } | null;
  applicant: {
    id: string;
    email: string;
    name: string;
    role: string;
    phone: string | null;
    phoneVerifiedAt: string | null;
    businessStatus: VerificationStatus;
    businessVerifiedAt: string | null;
    createdAt: string;
    supplierProfile: { businessName: string; verified: boolean } | null;
  };
  history: Array<{
    id: string;
    action: string;
    fromStatus: VerificationStatus | null;
    toStatus: VerificationStatus | null;
    reason: string | null;
    createdAt: string;
    actor: string;
  }>;
};

export type AdminVerificationStats = {
  applications: Record<VerificationStatus, number>;
  accounts: Record<VerificationStatus, number>;
  phoneVerified: number;
};

export function getAdminStats(): Promise<AdminVerificationStats> {
  return request("/admin/verification/stats");
}

export function getAdminApplications(query: {
  status?: VerificationStatus;
  role?: "SUPPLIER" | "AGRO_DEALER";
  q?: string;
  skip?: number;
  take?: number;
}): Promise<{
  items: AdminApplicationListItem[];
  total: number;
  skip: number;
  take: number;
}> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/admin/verification/applications${suffix}`);
}

export function getAdminApplication(
  id: string,
): Promise<AdminApplicationDetail> {
  return request(`/admin/verification/applications/${id}`);
}

export type AdminVerificationAction =
  | "start_review"
  | "approve"
  | "reject"
  | "request_info"
  | "suspend";

export function actOnApplication(
  id: string,
  action: AdminVerificationAction,
  reason?: string,
  notes?: string,
): Promise<{ id: string; status: VerificationStatus }> {
  return request(`/admin/verification/applications/${id}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, reason, notes }),
  });
}
