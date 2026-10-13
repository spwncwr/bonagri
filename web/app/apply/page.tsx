"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { authHeaders, fetchCurrentUser, type UserRole } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type SellerApplication = {
  id: string;
  desiredRole: "SUPPLIER" | "AGRO_DEALER";
  businessName: string;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const ROLE_LABELS: Record<SellerApplication["desiredRole"], string> = {
  SUPPLIER: "Supplier — sell fresh produce",
  AGRO_DEALER: "Agro dealer — sell tools, seed & chemicals",
};

export default function ApplyToSellPage() {
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  const [desiredRole, setDesiredRole] = useState<"SUPPLIER" | "AGRO_DEALER">(
    "SUPPLIER",
  );
  const [businessName, setBusinessName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const user = await fetchCurrentUser();

        if (cancelled) {
          return;
        }

        setRole(user?.role ?? null);

        // /mine is BUYER-only; vendors already sell and skip the fetch.
        if (!user || user.role !== "BUYER") {
          return;
        }

        const response = await fetch(
          `${API_BASE_URL}/api/seller-applications/mine`,
          {
            cache: "no-store",
            headers: authHeaders(),
          },
        );

        if (response.ok && !cancelled) {
          const data = (await response.json()) as SellerApplication | null;
          setApplication(data);
        }
      } catch {
        // Form still usable if the status check fails.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitApplication() {
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/seller-applications`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ desiredRole, businessName, message }),
      });

      const data = (await response.json().catch(() => null)) as {
        message?: string | string[];
      } | null;

      if (!response.ok) {
        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to submit your application",
        );
      }

      setApplication(data as SellerApplication);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to submit your application",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !application || application.status === "REJECTED";
  const isVendor = role === "SUPPLIER" || role === "AGRO_DEALER";

  return (
    <AuthGuard allowedRoles={["BUYER", "SUPPLIER", "AGRO_DEALER"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#17633a]">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Sell on BonAgri
              </h1>
            </div>

            <Link
              href="/"
              className="rounded-xl border border-[#dce2d9] bg-white px-4 py-2 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
            >
              ← Marketplace
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
          {isVendor ? (
            <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  You already sell on BonAgri
                </h2>
                <span className="rounded-full bg-[#e5f1e4] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#17633a]">
                  {role === "AGRO_DEALER" ? "Agro dealer" : "Supplier"}
                </span>
              </div>

              <p className="mt-3 text-sm text-[#344238]">
                This account already has a vendor profile, so there is nothing
                to apply for. Head to your hub to manage listings and orders.
              </p>

              <Link
                href="/supplier"
                className="mt-5 inline-block rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Open my vendor hub →
              </Link>
            </section>
          ) : (
            <>
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#69756c]">Loading your application...</p>
          ) : application && application.status === "PENDING" ? (
            <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Application under review
                </h2>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">
                  Pending
                </span>
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[#69756c]">Business name</dt>
                  <dd className="font-semibold">{application.businessName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#69756c]">Applying as</dt>
                  <dd className="font-semibold">
                    {ROLE_LABELS[application.desiredRole]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#69756c]">Applied</dt>
                  <dd>
                    {new Date(application.createdAt).toLocaleDateString(
                      "en-ZA",
                      {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      },
                    )}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-sm text-[#69756c]">
                The BonAgri team reviews every application. You will get an
                email and a notification here once it is decided.
              </p>
            </section>
          ) : application && application.status === "APPROVED" ? (
            <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  You are approved to sell!
                </h2>
                <span className="rounded-full bg-[#e5f1e4] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#17633a]">
                  Approved
                </span>
              </div>

              <p className="mt-3 text-sm text-[#344238]">
                {application.businessName} is live as a vendor. Head to your
                vendor hub to list products and manage orders.
              </p>

              <Link
                href="/supplier"
                className="mt-5 inline-block rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Open my vendor hub →
              </Link>
            </section>
          ) : null}

          {showForm ? (
            <section className="rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm">
              {application?.status === "REJECTED" ? (
                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">
                    Your previous application was not approved.
                  </p>
                  {application.reviewNote ? (
                    <p className="mt-1">Note from the team: {application.reviewNote}</p>
                  ) : null}
                  <p className="mt-1">
                    You can apply again below with updated details.
                  </p>
                </div>
              ) : null}

              <h2 className="text-lg font-semibold">Apply to sell</h2>
              <p className="mt-1 text-sm text-[#69756c]">
                Tell us what you want to sell. Admins review every application;
                once approved you can list products immediately.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="desired-role"
                    className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                  >
                    What do you want to sell?
                  </label>
                  <select
                    id="desired-role"
                    value={desiredRole}
                    onChange={(event) =>
                      setDesiredRole(
                        event.target.value as "SUPPLIER" | "AGRO_DEALER",
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                  >
                    <option value="SUPPLIER">
                      {ROLE_LABELS.SUPPLIER}
                    </option>
                    <option value="AGRO_DEALER">
                      {ROLE_LABELS.AGRO_DEALER}
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="business-name"
                    className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                  >
                    Business name
                  </label>
                  <input
                    id="business-name"
                    type="text"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    placeholder="e.g. Thandi Fresh Produce"
                    className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="application-message"
                    className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                  >
                    Anything the team should know? (optional)
                  </label>
                  <textarea
                    id="application-message"
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="e.g. We supply tomatoes, peppers and greens to Polokwane restaurants every week."
                    className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={submitting || !businessName.trim()}
                  onClick={() => void submitApplication()}
                  className="rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit application"}
                </button>
              </div>
            </section>
          ) : null}
            </>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
