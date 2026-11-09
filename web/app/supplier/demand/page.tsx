"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PageHeading from "../../../components/supplier/page-heading";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type BuyerRequest = {
  id: string;
  title: string;
  quantity: number;
  unit: string;
  destinationCity: string | null;
  requiredBy: string | null;
  notes: string | null;
  createdAt: string;
  category: { name: string; slug: string } | null;
};

type MyResponse = {
  id: string;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";
  message: string;
  quotedPrice: string | null;
  quotedUnit: string | null;
  createdAt: string;
  request: {
    id: string;
    title: string;
    quantity: number;
    unit: string;
    destinationCity: string | null;
    status: "OPEN" | "FULFILLED" | "WITHDRAWN";
  };
};

const RESPONSE_STATUS_STYLES: Record<MyResponse["status"], string> = {
  OPEN: "bg-emerald-100 text-emerald-800",
  ACCEPTED: "bg-[#e8f1e6] text-[#17633a]",
  DECLINED: "bg-slate-200 text-slate-600",
  WITHDRAWN: "bg-amber-100 text-amber-700",
};

function DemandContent() {
  const router = useRouter();
  const [buyerRequests, setBuyerRequests] = useState<BuyerRequest[]>([]);
  const [myResponses, setMyResponses] = useState<MyResponse[]>([]);
  const [respondMessage, setRespondMessage] = useState("");
  const [respondPrice, setRespondPrice] = useState("");
  const [respondUnit, setRespondUnit] = useState("");
  const [responding, setResponding] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState("");
  const [respondNotice, setRespondNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Public demand board (CP7): OPEN requests buyers have posted.
    const loadBuyerRequests = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/product-requests`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as BuyerRequest[];

        if (!cancelled) {
          setBuyerRequests(data);
        }
      } catch {
        // The requests panel is non-blocking; leave it empty on failure.
      }
    };

    void loadBuyerRequests();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // CP9: this vendor's own responses (SUPPLIER/AGRO_DEALER only).
    const loadMyResponses = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/product-requests/responses/mine`,
          {
            cache: "no-store",
            headers: authHeaders(),
          },
        );

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as MyResponse[];

        if (!cancelled) {
          setMyResponses(data);
        }
      } catch {
        // The responses panel is non-blocking; leave it empty on failure.
      }
    };

    void loadMyResponses();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitResponse(requestId: string) {
    setResponding(true);
    setRespondError("");
    setRespondNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/${requestId}/responses`,
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: respondMessage,
            ...(respondPrice ? { quotedPrice: Number(respondPrice) } : {}),
            ...(respondUnit ? { quotedUnit: respondUnit } : {}),
          }),
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
            : "Unable to send your response",
        );
      }

      const request = buyerRequests.find((item) => item.id === requestId);
      const created = (await response.json()) as {
        id: string;
        status: MyResponse["status"];
        message: string;
        quotedPrice: string | null;
        quotedUnit: string | null;
        createdAt: string;
      };

      setMyResponses((current) => [
        {
          ...created,
          request: {
            id: requestId,
            title: request?.title ?? "Buyer request",
            quantity: request?.quantity ?? 0,
            unit: request?.unit ?? "",
            destinationCity: request?.destinationCity ?? null,
            status: "OPEN",
          },
        },
        ...current,
      ]);
      // Clearing ?respond= closes the form without a remount, so the
      // "Response sent" notice below stays on screen.
      router.replace("/supplier/demand");
      setRespondMessage("");
      setRespondPrice("");
      setRespondUnit("");
      setRespondNotice("Response sent — the buyer will see it on their request.");
    } catch (err) {
      setRespondError(
        err instanceof Error ? err.message : "Unable to send your response",
      );
    } finally {
      setResponding(false);
    }
  }

  async function withdrawResponse(responseId: string) {
    setWithdrawingId(responseId);
    setRespondError("");
    setRespondNotice("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/product-requests/responses/${responseId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "WITHDRAWN" }),
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
            : "Unable to withdraw your response",
        );
      }

      const updated = (await response.json()) as { id: string; status: string };

      setMyResponses((current) =>
        current.map((item) =>
          item.id === updated.id
            ? { ...item, status: "WITHDRAWN" as const }
            : item,
        ),
      );
    } catch (err) {
      setRespondError(
        err instanceof Error ? err.message : "Unable to withdraw your response",
      );
    } finally {
      setWithdrawingId(null);
    }
  }

  // The dashboard's "Quote supply" link lands here as ?respond=<request id>.
  // The URL *is* the open-form state: Respond/Cancel navigate, and the form
  // is derived below — no effect needs to push it into React state.
  const respondParam = useSearchParams().get("respond");
  const openRespondId =
    respondParam &&
    !myResponses.some((item) => item.request.id === respondParam)
      ? respondParam
      : null;

  return (
    <>
      <PageHeading title="Demand board" fallback="/supplier" />
      <section className="mt-5 rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-lg font-black tracking-tight text-ink">
          Buyer requests
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          Open demand buyers have posted. Respond with what you can supply —
          the buyer accepts the response they like best.
        </p>

        {respondError ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {respondError}
          </div>
        ) : null}

        {respondNotice ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            {respondNotice}
          </div>
        ) : null}

        {buyerRequests.length === 0 ? (
          <p className="mt-4 text-sm text-[#69756c]">
            No open buyer requests right now.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {buyerRequests.map((request) => {
              const hasResponded = myResponses.some(
                (item) => item.request.id === request.id,
              );

              return (
                <li
                  key={request.id}
                  className="rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{request.title}</p>
                      <p className="mt-1 text-xs text-[#69756c]">
                        {request.quantity.toLocaleString("en-ZA")}{" "}
                        {request.unit}
                        {request.category
                          ? ` • ${request.category.name}`
                          : ""}
                        {request.destinationCity
                          ? ` • → ${request.destinationCity}`
                          : ""}
                        {request.requiredBy
                          ? ` • by ${new Date(
                              request.requiredBy,
                            ).toLocaleDateString("en-ZA", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </p>

                      {request.notes ? (
                        <p className="mt-1 text-xs text-[#7a857d]">
                          {request.notes}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {hasResponded ? (
                        <span className="rounded-full bg-[#e8f1e6] px-2.5 py-1 text-[10px] font-bold text-[#17633a]">
                          RESPONDED
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            router.replace(
                              openRespondId === request.id
                                ? "/supplier/demand"
                                : `/supplier/demand?respond=${request.id}`,
                            );
                            setRespondError("");
                            setRespondNotice("");
                          }}
                          className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          {openRespondId === request.id ? "Cancel" : "Respond"}
                        </button>
                      )}

                      <span className="rounded-full bg-[#e8f1e6] px-2.5 py-1 text-[10px] font-bold text-[#17633a]">
                        OPEN
                      </span>
                    </div>
                  </div>

                  {openRespondId === request.id ? (
                    <div className="mt-4 space-y-3 rounded-xl border border-[#dce2d9] bg-white p-4">
                      <div>
                        <label
                          htmlFor={`respond-message-${request.id}`}
                          className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                        >
                          What can you supply?
                        </label>
                        <textarea
                          id={`respond-message-${request.id}`}
                          rows={3}
                          value={respondMessage}
                          onChange={(event) =>
                            setRespondMessage(event.target.value)
                          }
                          placeholder="e.g. We can supply 2 tons of Grade 1 tomatoes weekly from Polokwane."
                          className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor={`respond-price-${request.id}`}
                            className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                          >
                            Quoted price (optional)
                          </label>
                          <input
                            id={`respond-price-${request.id}`}
                            type="number"
                            min={0.01}
                            step="0.01"
                            value={respondPrice}
                            onChange={(event) =>
                              setRespondPrice(event.target.value)
                            }
                            placeholder="e.g. 12.50"
                            className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor={`respond-unit-${request.id}`}
                            className="block text-xs font-bold uppercase tracking-wide text-[#7b867d]"
                          >
                            Price unit (optional)
                          </label>
                          <input
                            id={`respond-unit-${request.id}`}
                            type="text"
                            value={respondUnit}
                            onChange={(event) =>
                              setRespondUnit(event.target.value)
                            }
                            placeholder="e.g. per kg"
                            className="mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={responding || respondMessage.trim().length === 0}
                        onClick={() => void submitResponse(request.id)}
                        className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {responding ? "Sending..." : "Send response"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="mt-5 rounded-3xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-lg font-black tracking-tight text-ink">
          My responses
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          Responses you have sent on buyer requests. Accepted responses mean
          the buyer picked you.
        </p>

        {myResponses.length === 0 ? (
          <p className="mt-4 text-sm text-[#69756c]">
            You have not responded to any buyer requests yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {myResponses.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-[#e3e8e1] bg-[#fafbf8] p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{item.request.title}</p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${RESPONSE_STATUS_STYLES[item.status]}`}
                      >
                        {item.status}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-[#69756c]">
                      {item.request.quantity.toLocaleString("en-ZA")}{" "}
                      {item.request.unit}
                      {item.request.destinationCity
                        ? ` • → ${item.request.destinationCity}`
                        : ""}
                      {" • "}
                      {new Date(item.createdAt).toLocaleDateString("en-ZA", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>

                    <p className="mt-1 text-xs text-[#7a857d]">
                      {item.message}
                    </p>

                    {item.quotedPrice ? (
                      <p className="mt-1 text-xs font-semibold text-[#17633a]">
                        R{" "}
                        {Number(item.quotedPrice).toLocaleString("en-ZA", {
                          minimumFractionDigits: 2,
                        })}
                        {item.quotedUnit ? ` ${item.quotedUnit}` : ""}
                      </p>
                    ) : null}
                  </div>

                  {item.status === "OPEN" ? (
                    <button
                      type="button"
                      disabled={withdrawingId === item.id}
                      onClick={() => void withdrawResponse(item.id)}
                      className="rounded-lg border border-[#e5d9c5] bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {withdrawingId === item.id
                        ? "Working..."
                        : "Withdraw"}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function DemandPage() {
  return (
    <Suspense fallback={null}>
      <DemandContent />
    </Suspense>
  );
}
