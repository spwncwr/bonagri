import type {
  VerificationDocumentKind,
  UserRole,
} from "../common/types";

// CP17: document requirements live here — one configurable table, not
// hardcoded checks in the UI. Roles differ (an agro-dealer may need an
// agricultural-input licence; a plain supplier never does), and the licence
// only becomes REQUIRED when the application declares controlled-input
// categories (see `licenceCategories` below), so dealers are not forced to
// upload paperwork that does not apply to them.

export type DocumentRequirement = {
  kind: VerificationDocumentKind;
  label: string;
  why: string;
  required: boolean;
};

type RoleRequirementConfig = {
  required: VerificationDocumentKind[];
  recommended: VerificationDocumentKind[];
  optional: VerificationDocumentKind[];
};

const LABELS: Record<VerificationDocumentKind, { label: string; why: string }> =
  {
    BUSINESS_REGISTRATION: {
      label: "Business registration evidence",
      why: "Proof the business exists — CIPC certificate, business registration or trading name certificate.",
    },
    BUSINESS_LICENCE: {
      label: "Business or trading licence",
      why: "Municipal or provincial trading licence, where the business operates under one.",
    },
    AGRICULTURAL_INPUT_LICENCE: {
      label: "Agricultural input licence or permit",
      why: "Required when you sell regulated agricultural inputs (e.g. pesticides, fertiliser, veterinary products).",
    },
    PROOF_OF_BUSINESS_ADDRESS: {
      label: "Proof of business location",
      why: "Utility bill, lease agreement or rates account showing the physical trading address.",
    },
    OWNER_ID: {
      label: "Owner or representative ID",
      why: "Identity document of the owner or the authorised representative signing this application.",
    },
    OTHER: {
      label: "Additional supporting document",
      why: "Anything else that supports your application — supply contracts, permits or certifications.",
    },
  };

const ROLE_CONFIG: Record<"SUPPLIER" | "AGRO_DEALER", RoleRequirementConfig> =
  {
    SUPPLIER: {
      required: ["BUSINESS_REGISTRATION"],
      recommended: ["PROOF_OF_BUSINESS_ADDRESS", "OWNER_ID"],
      optional: ["BUSINESS_LICENCE", "OTHER"],
    },
    AGRO_DEALER: {
      required: ["BUSINESS_REGISTRATION"],
      // Only enforced when the application declares licence categories.
      recommended: ["AGRICULTURAL_INPUT_LICENCE"],
      optional: [
        "BUSINESS_LICENCE",
        "PROOF_OF_BUSINESS_ADDRESS",
        "OWNER_ID",
        "OTHER",
      ],
    },
  };

export type DocumentRequirements = {
  role: "SUPPLIER" | "AGRO_DEALER";
  requirements: DocumentRequirement[];
};

export function getDocumentRequirements(
  role: UserRole,
  details?: { licenceCategories?: unknown } | null,
): DocumentRequirements | null {
  if (role !== "SUPPLIER" && role !== "AGRO_DEALER") {
    return null;
  }

  const config = ROLE_CONFIG[role];
  const declaresLicence =
    role === "AGRO_DEALER" &&
    Array.isArray(details?.licenceCategories) &&
    details.licenceCategories.length > 0;

  const requirements: DocumentRequirement[] = (
    Object.keys(LABELS) as VerificationDocumentKind[]
  ).map((kind) => {
    const { label, why } = LABELS[kind];
    const required =
      config.required.includes(kind) ||
      (kind === "AGRICULTURAL_INPUT_LICENCE" && declaresLicence);

    return { kind, label, why, required };
  });

  return { role, requirements };
}

// Kinds a role may attach (required + recommended + optional = everything
// except kinds from the other role's table — both roles share the same
// universe today, kept as a set so adding a role-specific kind later cannot
// silently accept it from every role).
export function allowedDocumentKinds(
  role: "SUPPLIER" | "AGRO_DEALER",
): VerificationDocumentKind[] {
  const config = ROLE_CONFIG[role];
  return [...config.required, ...config.recommended, ...config.optional];
}

// The effective required list for a concrete application — this is what
// submission validation enforces.
export function requiredDocumentKinds(
  role: "SUPPLIER" | "AGRO_DEALER",
  details?: { licenceCategories?: unknown } | null,
): VerificationDocumentKind[] {
  const built = getDocumentRequirements(role, details);
  if (!built) {
    return [];
  }
  return built.requirements.filter((r) => r.required).map((r) => r.kind);
}
