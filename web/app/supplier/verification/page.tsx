"use client";

// CP17: supplier / agro-dealer Verification Centre. One screen for the whole
// business-verification lifecycle: current status, the application form with
// document upload (private Cloudinary assets — the browser only ever holds a
// publicId), corrections resubmission after ACTION_REQUIRED, and the audit
// history of past decisions.
//
// What this screen can NEVER do is approve anything — status only moves to
// VERIFIED through the admin review centre.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeading from "../../../components/supplier/page-heading";
import {
  getDocumentUrl,
  getVerificationSummary,
  listMyApplications,
  resubmitApplication,
  submitApplication,
  VerificationApiError,
  type ApplicationPayload,
  type DocumentRequirement,
  type OwnApplication,
  type VerificationDocumentKind,
  type VerificationStatus,
  type VerificationSummary,
} from "../../../lib/verification";
import {
  uploadVerificationDocument,
  validateVerificationDocument,
} from "../../../lib/media";

const FIELD =
  "mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none";
const LABEL =
  "block text-xs font-bold uppercase tracking-wide text-[#7b867d]";

const STATUS_STYLES: Record<VerificationStatus, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-700 border-slate-200",
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  UNDER_REVIEW: "bg-sky-50 text-sky-800 border-sky-200",
  ACTION_REQUIRED: "bg-orange-50 text-orange-800 border-orange-200",
  VERIFIED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-800 border-rose-200",
  SUSPENDED: "bg-rose-100 text-rose-900 border-rose-300",
};

const STATUS_LABELS: Record<VerificationStatus, string> = {
  NOT_STARTED: "Not started",
  PENDING: "Awaiting review",
  UNDER_REVIEW: "Under review",
  ACTION_REQUIRED: "Changes requested",
  VERIFIED: "Business verified",
  REJECTED: "Not approved",
  SUSPENDED: "Suspended",
};

const STATUS_BLURB: Record<VerificationStatus, string> = {
  NOT_STARTED:
    "Submit your business details and documents once. An admin reviews every application by hand — publishing listings and accepting orders unlock after approval.",
  PENDING:
    "Your application is in the review queue. You will be notified when an admin decides.",
  UNDER_REVIEW:
    "An admin is reviewing your application now.",
  ACTION_REQUIRED:
    "The reviewer needs something fixed before they can continue. Update the highlighted items below and resubmit — your previous submission stays on file.",
  VERIFIED:
    "Your business is verified. The Business verified badge shows on your listings, and publishing and order acceptance are unlocked.",
  REJECTED:
    "Your application was not approved. Review the feedback below, fix the issues and submit a fresh application.",
  SUSPENDED:
    "Your business verification is suspended. Contact the BonAgri team to resolve this.",
};

type DocumentSlot = {
  kind: VerificationDocumentKind;
  /** Fresh Cloudinary upload reference. Mutually exclusive with documentId. */
  publicId?: string;
  /** Kept row of the existing application (corrections resubmission). */
  documentId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploading: boolean;
};

type FormState = {
  businessName: string;
  registrationNumber: string;
  contactPhone: string;
  contactEmail: string;
  physicalAddress: string;
  representativeName: string;
  licenceCategories: string;
};

function emptyForm(): FormState {
  return {
    businessName: "",
    registrationNumber: "",
    contactPhone: "",
    contactEmail: "",
    physicalAddress: "",
    representativeName: "",
    licenceCategories: "",
  };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SupplierVerificationPage() {
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [applications, setApplications] = useState<OwnApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState<FormState>(emptyForm);
  const [slots, setSlots] = useState<DocumentSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] =
    useState<VerificationDocumentKind>("BUSINESS_REGISTRATION");

  const status: VerificationStatus = summary?.business.status ?? "NOT_STARTED";
  const latest = summary?.business.latestApplication ?? null;

  // The application being edited: corrections reopen the ACTION_REQUIRED row;
  // a fresh track starts from NOT_STARTED / REJECTED.
  const resubmitTarget =
    status === "ACTION_REQUIRED" && latest ? latest.id : null;

  const requirements: DocumentRequirement[] = useMemo(
    () => summary?.business.requirements?.requirements ?? [],
    [summary],
  );

  const requiredKinds = useMemo(
    () =>
      requirements.filter((entry) => entry.required).map((entry) => entry.kind),
    [requirements],
  );

  const canSubmit = useMemo(() => {
    if (!form.businessName.trim() || !form.contactPhone.trim()) return false;
    if (!form.physicalAddress.trim() || !form.representativeName.trim()) {
      return false;
    }
    return requiredKinds.every((kind) =>
      slots.some((slot) => slot.kind === kind),
    );
  }, [form, requiredKinds, slots]);

  const load = useCallback(async () => {
    try {
      const [nextSummary, mine] = await Promise.all([
        getVerificationSummary(),
        listMyApplications(),
      ]);
      setSummary(nextSummary);
      setApplications(mine.items);

      // Prefill from the latest application so corrections and history view
      // do not force retyping. Document rows are only carried over for the
      // ACTION_REQUIRED resubmission (their ids belong to that row); a fresh
      // application after a rejection starts with an empty document set.
      const previous = mine.items[0];
      if (previous) {
        const details = previous.details as { licenceCategories?: string[] };
        setForm({
          businessName: previous.businessName,
          registrationNumber: previous.registrationNumber ?? "",
          contactPhone: previous.contactPhone,
          contactEmail: previous.contactEmail ?? "",
          physicalAddress: previous.physicalAddress,
          representativeName: previous.representativeName,
          licenceCategories: Array.isArray(details?.licenceCategories)
            ? details.licenceCategories.join(", ")
            : "",
        });
        if (previous.status === "ACTION_REQUIRED") {
          setSlots(
            previous.documents.map((doc) => ({
              kind: doc.kind,
              // Kept documents reference their row on this application; the
              // server resolves them back to the stored asset on resubmit.
              documentId: doc.id,
              fileName: doc.fileName ?? doc.kind,
              mimeType: doc.mimeType ?? "",
              sizeBytes: doc.sizeBytes ?? 0,
              uploading: false,
            })),
          );
        }
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load your verification status.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // load() is async: summary/application state updates only run after the
    // awaited requests resolve, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handlePickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const problem = validateVerificationDocument(file);
    if (problem) {
      setError(problem);
      return;
    }

    setError("");
    setSlots((current) => [
      // Replacing a kept document with a fresh upload of the same kind.
      ...current.filter((slot) => slot.kind !== pendingKind),
      {
        kind: pendingKind,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        uploading: true,
      },
    ]);

    try {
      const { publicId } = await uploadVerificationDocument(file);
      setSlots((current) =>
        current.map((slot) =>
          slot.kind === pendingKind && slot.uploading
            ? { ...slot, publicId, uploading: false }
            : slot,
        ),
      );
    } catch (uploadError) {
      setSlots((current) =>
        current.filter(
          (slot) => !(slot.kind === pendingKind && slot.uploading),
        ),
      );
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The upload failed — try again.",
      );
    }
  }

  // Fresh uploads carry their Cloudinary publicId; kept documents reference
  // their row — the server maps both onto stored asset references.
  function buildPayload(): ApplicationPayload {
    const categories = form.licenceCategories
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      businessName: form.businessName.trim(),
      registrationNumber: form.registrationNumber.trim() || undefined,
      contactPhone: form.contactPhone.trim(),
      contactEmail: form.contactEmail.trim() || undefined,
      physicalAddress: form.physicalAddress.trim(),
      representativeName: form.representativeName.trim(),
      ...(categories.length
        ? { details: { licenceCategories: categories } }
        : {}),
      documents: slots.map((slot) => ({
        kind: slot.kind,
        ...(slot.publicId ? { publicId: slot.publicId } : {}),
        ...(slot.documentId ? { documentId: slot.documentId } : {}),
        fileName: slot.fileName,
        mimeType: slot.mimeType || undefined,
        sizeBytes: slot.sizeBytes || undefined,
      })),
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    if (
      slots.some(
        (slot) => slot.uploading || (!slot.publicId && !slot.documentId),
      )
    ) {
      setError("Wait for every document upload to finish first.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      const payload = buildPayload();
      if (resubmitTarget) {
        await resubmitApplication(resubmitTarget, payload);
        setNotice(
          "Updated application resubmitted — the reviewer will pick it up again.",
        );
      } else {
        await submitApplication(payload);
        setNotice("Application submitted — an admin will review it.");
      }
      setSlots([]);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof VerificationApiError
          ? submitError.message
          : submitError instanceof Error
            ? submitError.message
            : "Could not submit your application — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openDocument(applicationId: string, documentId: string) {
    try {
      const { url } = await getDocumentUrl(applicationId, documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Could not open that document.",
      );
    }
  }

  const blocked =
    status === "PENDING" ||
    status === "UNDER_REVIEW" ||
    status === "VERIFIED" ||
    status === "SUSPENDED";

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeading
          title="Verification"
          description="Business verification for your storefront."
        />
        <div className="rounded-2xl border border-line bg-surface p-6">
          <p className="text-sm text-ink-muted">Loading verification…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <PageHeading
        title="Verification"
        description="Business verification unlocks publishing and order acceptance, and shows the Business verified badge on your listings."
        fallback="/supplier"
      />

      {/* Status banner — always the first thing on the screen. */}
      <section
        aria-label="Verification status"
        className={`rounded-2xl border p-4 sm:p-5 ${STATUS_STYLES[status]}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider">
              Business status
            </p>
            <p className="mt-1 text-lg font-black">
              {STATUS_LABELS[status]}
            </p>
          </div>
          {summary?.business.verifiedAt ? (
            <p className="text-xs font-semibold">
              Verified {formatDate(summary.business.verifiedAt)}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-sm leading-6">{STATUS_BLURB[status]}</p>

        {/* User-facing reasons ride with the status that produced them. */}
        {status === "ACTION_REQUIRED" && latest?.infoRequest ? (
          <p className="mt-3 rounded-xl border border-orange-300 bg-white/70 px-4 py-3 text-sm font-semibold text-orange-900">
            Reviewer: {latest.infoRequest}
          </p>
        ) : null}
        {status === "REJECTED" && latest?.rejectionReason ? (
          <p className="mt-3 rounded-xl border border-rose-300 bg-white/70 px-4 py-3 text-sm font-semibold text-rose-900">
            Reason: {latest.rejectionReason}
          </p>
        ) : null}
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      ) : null}

      {/* The form: hidden while a decision is in flight (only corrections,
          rejection or not-started open it again). */}
      {!blocked ? (
        <form
          onSubmit={handleSubmit}
          aria-label="Business verification application"
          className="rounded-2xl border border-line bg-surface p-4 sm:p-6"
        >
          <h2 className="text-lg font-black tracking-tight text-ink">
            {resubmitTarget
              ? "Update your application"
              : "Business details"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            {resubmitTarget
              ? "Fix what the reviewer asked for and resubmit. Unchanged documents are kept."
              : "Everything here is reviewed by a BonAgri admin before your badge is granted."}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="vc-business-name" className={LABEL}>
                Business trading name
              </label>
              <input
                id="vc-business-name"
                type="text"
                required
                value={form.businessName}
                onChange={(event) =>
                  setForm({ ...form, businessName: event.target.value })
                }
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="vc-reg-number" className={LABEL}>
                Registration number (if registered)
              </label>
              <input
                id="vc-reg-number"
                type="text"
                value={form.registrationNumber}
                onChange={(event) =>
                  setForm({ ...form, registrationNumber: event.target.value })
                }
                placeholder="2026/001234/07"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="vc-contact-phone" className={LABEL}>
                Business contact number
              </label>
              <input
                id="vc-contact-phone"
                type="tel"
                required
                value={form.contactPhone}
                onChange={(event) =>
                  setForm({ ...form, contactPhone: event.target.value })
                }
                placeholder="082 123 4567"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="vc-contact-email" className={LABEL}>
                Business email (optional)
              </label>
              <input
                id="vc-contact-email"
                type="email"
                value={form.contactEmail}
                onChange={(event) =>
                  setForm({ ...form, contactEmail: event.target.value })
                }
                className={FIELD}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="vc-address" className={LABEL}>
                Physical business address
              </label>
              <input
                id="vc-address"
                type="text"
                required
                value={form.physicalAddress}
                onChange={(event) =>
                  setForm({ ...form, physicalAddress: event.target.value })
                }
                placeholder="Street, town, province"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="vc-representative" className={LABEL}>
                Owner / authorised representative
              </label>
              <input
                id="vc-representative"
                type="text"
                required
                value={form.representativeName}
                onChange={(event) =>
                  setForm({ ...form, representativeName: event.target.value })
                }
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="vc-licence-categories" className={LABEL}>
                Regulated input categories (agro-dealers)
              </label>
              <input
                id="vc-licence-categories"
                type="text"
                value={form.licenceCategories}
                onChange={(event) =>
                  setForm({ ...form, licenceCategories: event.target.value })
                }
                placeholder="e.g. Category B pesticides"
                aria-describedby="vc-licence-hint"
                className={FIELD}
              />
              <p
                id="vc-licence-hint"
                className="mt-1.5 text-xs leading-5 text-ink-muted"
              >
                Listing categories here makes the agricultural input licence a
                required document.
              </p>
            </div>
          </div>

          {/* Requirements the API told us are mandatory for this role. */}
          <div className="mt-6">
            <h3 className="text-sm font-black tracking-tight text-ink">
              Documents
            </h3>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Upload each required document below. Files are stored privately —
              only you and BonAgri admins can open them, through a short-lived
              signed link.
            </p>

            <ul className="mt-3 space-y-1.5">
              {requirements.map((entry) => {
                const attached = slots.find(
                  (slot) => slot.kind === entry.kind,
                );
                return (
                  <li
                    key={entry.kind}
                    className="flex items-start justify-between gap-3 rounded-xl border border-line bg-page px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">
                        {entry.label}
                        {entry.required ? (
                          <span className="ml-1.5 text-rose-600">*</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                        {entry.why}
                      </p>
                      {attached ? (
                        <p className="mt-1 truncate text-xs font-semibold text-emerald-700">
                          {attached.fileName}
                          {attached.sizeBytes
                            ? ` · ${formatBytes(attached.sizeBytes)}`
                            : ""}
                          {attached.uploading ? " · uploading…" : ""}
                        </p>
                      ) : null}
                    </div>
                    {attached ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSlots((current) =>
                            current.filter(
                              (slot) => slot.kind !== entry.kind,
                            ),
                          )
                        }
                        className="shrink-0 text-xs font-semibold text-rose-600 underline-offset-4 hover:underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* One uploader for whichever kind the vendor selects — keeps the
                required/recommended list as the single source of truth. */}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="vc-doc-kind" className={LABEL}>
                  Document type
                </label>
                <select
                  id="vc-doc-kind"
                  value={pendingKind}
                  onChange={(event) =>
                    setPendingKind(
                      event.target.value as VerificationDocumentKind,
                    )
                  }
                  className={FIELD}
                >
                  {requirements.map((entry) => (
                    <option key={entry.kind} value={entry.kind}>
                      {entry.label}
                      {entry.required ? " (required)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <label
                htmlFor="vc-doc-file"
                className="cursor-pointer rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-surface"
              >
                Choose file
              </label>
              <input
                id="vc-doc-file"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
                className="sr-only"
                onChange={(event) => void handlePickFile(event)}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="rounded-xl bg-[#17633a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Submitting…"
                : resubmitTarget
                  ? "Resubmit application"
                  : "Submit for review"}
            </button>
          </div>
        </form>
      ) : null}

      {/* Decision history — every past admin action, oldest first. */}
      {applications.length > 0 ? (
        <section
          aria-label="Application history"
          className="rounded-2xl border border-line bg-surface p-4 sm:p-5"
        >
          <h2 className="text-lg font-black tracking-tight text-ink">
            Application history
          </h2>
          <div className="mt-3 space-y-3">
            {applications.map((application) => (
              <article
                key={application.id}
                className="rounded-xl border border-line bg-page p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-ink">
                    {application.businessName}
                  </p>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-black ${STATUS_STYLES[application.status]}`}
                  >
                    {STATUS_LABELS[application.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Submitted {formatDate(application.submittedAt)}
                </p>

                {application.documents.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {application.documents.map((doc) => (
                      <li key={doc.id}>
                        <button
                          type="button"
                          onClick={() =>
                            void openDocument(application.id, doc.id)
                          }
                          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
                        >
                          {doc.fileName ?? doc.kind}
                          {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {application.history && application.history.length > 0 ? (
                  <ol className="mt-3 space-y-1 border-t border-line pt-2">
                    {application.history.map((entry) => (
                      <li
                        key={entry.id}
                        className="text-xs leading-5 text-ink-muted"
                      >
                        <span className="font-bold text-ink-soft">
                          {entry.action.replace(/_/g, " ").toLowerCase()}
                        </span>{" "}
                        · {formatDate(entry.createdAt)}
                        {entry.reason ? ` — ${entry.reason}` : ""}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
