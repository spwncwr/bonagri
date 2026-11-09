"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { BrandLogo } from "../../components/brand/logo";
import { ArrowLeftIcon } from "../../components/mobile/icons";
import { authHeaders } from "../../lib/auth";
import { goBackOr } from "../../lib/navigation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Category = {
  id: string;
  name: string;
};

type ProductRequest = {
  id: string;
  title: string;
  quantity: number;
  unit: string;
  destinationCity: string | null;
  requiredBy: string | null;
  notes: string | null;
  status: "OPEN" | "FULFILLED" | "WITHDRAWN";
  createdAt: string;
  category: { name: string; slug: string } | null;
  _count?: { responses: number };
};

type RequestResponse = {
  id: string;
  message: string;
  quotedPrice: string | null;
  quotedUnit: string | null;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  createdAt: string;
  supplier: {
    businessName: string;
    city: string | null;
    verified: boolean;
  };
};

const RESPONSE_STYLES: Record<RequestResponse["status"], string> = {
  OPEN: "bg-emerald-100 text-emerald-800",
  ACCEPTED: "bg-[#e8f1e6] text-[#17633a]",
  DECLINED: "bg-slate-200 text-slate-600",
  WITHDRAWN: "bg-amber-100 text-amber-700",
};

const STATUS_STYLES: Record<ProductRequest["status"], string> = {
  OPEN: "bg-emerald-100 text-emerald-800",
  FULFILLED: "bg-slate-200 text-slate-600",
  WITHDRAWN: "bg-amber-100 text-amber-700",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function RequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [responses, setResponses] = useState<RequestResponse[]>([]);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // True back: return to the screen the buyer came from (profile or the
  // orders view). Fresh deep links fall back to the profile hub — see
  // lib/navigation.ts.
  function goBack() {
    goBackOr(router, "/profile");
  }

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [requestsResponse, categoriesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/product-requests/mine`, {
            cache: "no-store",
            headers: authHeaders(),
          }),
          fetch(`${API_BASE_URL}/api/categories`, { cache: "no-store" }),
        ]);

        if (!cancelled && requestsResponse.ok) {
          setRequests((await requestsResponse.json()) as ProductRequest[]);
        }

        if (!cancelled && categoriesResponse.ok) {
          setCategories((await categoriesResponse.json()) as Category[]);
        }
      } catch {
        // Lists stay empty on failure; the form still works.
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

  async function submitRequest() {
    setSubmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/product-requests`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          quantity: Number(quantity),
          unit,
          ...(categoryId ? { categoryId } : {}),
          ...(destinationCity ? { destinationCity } : {}),
          ...(requiredBy ? { requiredBy } : {}),
          ...(notes ? { notes } : {}),
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        message?: string | string[];
        id?: string;
      } | null;

      if (!response.ok) {
        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to post your request",
        );
      }

      setRequests((current) => [
        data as ProductRequest,
        ...current,
      ]);
      setTitle("");
      setQuantity("");
      setUnit("");
      setDestinationCity("");
      setRequiredBy("");
      setNotes("");
      setCategoryId("");
      setNotice(
        "Request posted — suppliers can now see what you are looking for.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post your request");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateRequest(
    requestId: string,
    status: "FULFILLED" | "WITHDRAWN",
  ) {
    setActingId(requestId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/${requestId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to update this request",
        );
      }

      const updated = (await response.json()) as ProductRequest;
      setRequests((current) =>
        current.map((item) => (item.id === requestId ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update this request");
    } finally {
      setActingId(null);
    }
  }

  async function toggleResponses(requestId: string) {
    if (expandedId === requestId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(requestId);
    setResponses([]);
    setResponsesLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/${requestId}/responses`,
        {
          cache: "no-store",
          headers: authHeaders(),
        },
      );

      if (response.ok) {
        setResponses((await response.json()) as RequestResponse[]);
      }
    } catch {
      // Panel stays empty on failure; user can retry by re-expanding.
    } finally {
      setResponsesLoading(false);
    }
  }

  async function decideResponse(
    responseId: string,
    status: "ACCEPTED" | "DECLINED",
  ) {
    setRespondingId(responseId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/responses/${responseId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to update this response",
        );
      }

      setResponses((current) =>
        current.map((item) => {
          if (item.id === responseId) {
            return { ...item, status };
          }

          // Accepting closes every other live response server-side too.
          if (
            status === "ACCEPTED" &&
            item.id !== responseId &&
            item.status === "OPEN"
          ) {
            return { ...item, status: "DECLINED" as const };
          }

          return item;
        }),
      );

      setNotice(
        status === "ACCEPTED"
          ? "Response accepted — the supplier has been notified."
          : "Response declined.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update this response");
    } finally {
      setRespondingId(null);
    }
  }

  const canSubmit =
    title.trim().length > 0 &&
    quantity.trim().length > 0 &&
    Number(quantity) >= 1 &&
    unit.trim().length > 0;

  return (
    <AuthGuard allowedRoles={["BUYER"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto max-w-2xl px-4 py-4">
            <div className="min-w-0">
              <BrandLogo height={22} />
              <h1 className="mt-2 text-xl font-black tracking-tight text-[#17251b]">
                Product requests
              </h1>
            </div>

            {/* Own action row so the title never squeezes on thin phones. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                Back
              </button>

              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                Marketplace
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {notice ? (
            <div
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {notice}
            </div>
          ) : null}

          <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-black tracking-tight text-[#17251b]">
              Post a product request
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#69756c]">
              Can&apos;t find what you need? Tell suppliers what you are looking
              for — quantity, destination and timing. Open requests appear on
              the public demand board.
            </p>

            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor="request-title"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  What do you need?
                </label>
                <input
                  id="request-title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Grade 1 tomatoes"
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>

              <div>
                <label
                  htmlFor="request-category"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Category (optional)
                </label>
                <select
                  id="request-category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                >
                  <option value="">Any category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="request-city"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Destination city (optional)
                </label>
                <input
                  id="request-city"
                  type="text"
                  value={destinationCity}
                  onChange={(event) => setDestinationCity(event.target.value)}
                  placeholder="e.g. Polokwane"
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>

              <div>
                <label
                  htmlFor="request-quantity"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Quantity
                </label>
                <input
                  id="request-quantity"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="e.g. 3000"
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>

              <div>
                <label
                  htmlFor="request-unit"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Unit
                </label>
                <input
                  id="request-unit"
                  type="text"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder="e.g. kg, crates, tons"
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>

              <div>
                <label
                  htmlFor="request-by"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Required by (optional)
                </label>
                <input
                  id="request-by"
                  type="date"
                  value={requiredBy}
                  onChange={(event) => setRequiredBy(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="request-notes"
                  className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                >
                  Notes (optional)
                </label>
                <textarea
                  id="request-notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="e.g. Grade 1, delivery to our Polokwane warehouse every Monday."
                  className="mt-1.5 w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-2.5 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={submitting || !canSubmit}
              onClick={() => void submitRequest()}
              className="mt-5 w-full rounded-full bg-[#17633a] py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Posting..." : "Post request"}
            </button>
          </section>

          <section className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-black tracking-tight text-[#17251b]">
              My requests
            </h2>

            {loading ? (
              <p className="mt-3 text-sm text-[#69756c]">Loading requests...</p>
            ) : requests.length === 0 ? (
              <p className="mt-3 text-sm text-[#69756c]">
                You have not posted any requests yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {requests.map((request) => (
                  <li
                    key={request.id}
                    className="rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-3.5 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-[#17251b]">
                            {request.title}
                          </p>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLES[request.status]}`}
                          >
                            {request.status}
                          </span>
                        </div>

                        <p className="mt-1 text-xs leading-5 text-[#69756c]">
                          {request.quantity.toLocaleString("en-ZA")}{" "}
                          {request.unit}
                          {request.category
                            ? ` • ${request.category.name}`
                            : ""}
                          {request.destinationCity
                            ? ` • → ${request.destinationCity}`
                            : ""}
                          {request.requiredBy
                            ? ` • by ${formatDate(request.requiredBy)}`
                            : ""}
                        </p>

                        {request.notes ? (
                          <p className="mt-1 text-xs leading-5 text-[#7a857d]">
                            {request.notes}
                          </p>
                        ) : null}
                      </div>

                      {request.status === "OPEN" ? (
                        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                          <button
                            type="button"
                            onClick={() => void toggleResponses(request.id)}
                            className="rounded-full border border-[#dce2d9] bg-white px-3.5 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#f7f8f4] active:scale-[0.98]"
                          >
                            {expandedId === request.id
                              ? "Hide responses"
                              : `View responses (${request._count?.responses ?? 0})`}
                          </button>

                          <button
                            type="button"
                            disabled={actingId === request.id}
                            onClick={() =>
                              void updateRequest(request.id, "FULFILLED")
                            }
                            className="rounded-full border border-emerald-200 bg-white px-3.5 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {actingId === request.id
                              ? "Working..."
                              : "Mark fulfilled"}
                          </button>

                          <button
                            type="button"
                            disabled={actingId === request.id}
                            onClick={() =>
                              void updateRequest(request.id, "WITHDRAWN")
                            }
                            className="rounded-full border border-[#e5d9c5] bg-white px-3.5 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Withdraw
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {expandedId === request.id ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-[#dce2d9] bg-[#fafbf8] p-3">
                        {responsesLoading ? (
                          <p className="text-xs text-[#69756c]">
                            Loading responses...
                          </p>
                        ) : responses.length === 0 ? (
                          <p className="text-xs text-[#69756c]">
                            No responses yet.
                          </p>
                        ) : (
                          responses.map((response) => (
                            <div
                              key={response.id}
                              className="rounded-lg border border-[#e3e8e1] bg-white p-3 text-xs"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-[#17251b]">
                                      {response.supplier.businessName}
                                    </p>
                                    {response.supplier.verified ? (
                                      <span className="rounded-full bg-[#e8f1e6] px-2 py-0.5 text-[9px] font-bold text-[#17633a]">
                                        VERIFIED
                                      </span>
                                    ) : null}
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${RESPONSE_STYLES[response.status]}`}
                                    >
                                      {response.status}
                                    </span>
                                  </div>

                                  <p className="mt-1 leading-5 text-[#7a857d]">
                                    {response.message}
                                  </p>

                                  {response.quotedPrice ? (
                                    <p className="mt-1 font-semibold text-[#17633a]">
                                      R{" "}
                                      {Number(
                                        response.quotedPrice,
                                      ).toLocaleString("en-ZA", {
                                        minimumFractionDigits: 2,
                                      })}
                                      {response.quotedUnit
                                        ? ` ${response.quotedUnit}`
                                        : ""}
                                    </p>
                                  ) : null}
                                </div>

                                {response.status === "OPEN" &&
                                request.status === "OPEN" ? (
                                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                                    <button
                                      type="button"
                                      disabled={respondingId === response.id}
                                      onClick={() =>
                                        void decideResponse(
                                          response.id,
                                          "ACCEPTED",
                                        )
                                      }
                                      className="rounded-full border border-emerald-200 bg-white px-3.5 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {respondingId === response.id
                                        ? "Working..."
                                        : "Accept"}
                                    </button>

                                    <button
                                      type="button"
                                      disabled={respondingId === response.id}
                                      onClick={() =>
                                        void decideResponse(
                                          response.id,
                                          "DECLINED",
                                        )
                                      }
                                      className="rounded-full border border-[#e5d9c5] bg-white px-3.5 py-1.5 text-[11px] font-bold text-amber-700 transition hover:bg-amber-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Decline
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </AuthGuard>
  );
}
