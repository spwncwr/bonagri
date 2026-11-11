"use client";

// CP17: buyer phone verification card. Browse stays free — this only removes
// the checkout gate. The 6-digit code is emailed to the account's verified
// address (the trusted channel in this stack; no SMS provider), so the card
// always tells the buyer where the code went.
//
// Self-contained: fetches its own summary, so it can be dropped into any
// buyer settings screen without prop plumbing.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmPhoneOtp,
  getVerificationSummary,
  sendPhoneOtp,
  VerificationApiError,
  type VerificationSummary,
} from "../../lib/verification";

const FIELD =
  "mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none";
const LABEL =
  "block text-xs font-bold uppercase tracking-wide text-[#7b867d]";

type Props = {
  /** Rendered inline on the mobile settings screen; used for spacing only. */
  className?: string;
};

export default function PhoneVerificationCard({ className = "" }: Props) {
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code-sent">("idle");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getVerificationSummary();
      setSummary(next);
      setPhone(next.phone.number ?? "");
      if (next.phone.verified) {
        setStage("idle");
      } else if (next.phone.pendingPhone) {
        // A live code survives a reload — restore the confirm step.
        setPhone(next.phone.pendingPhone);
        setStage("code-sent");
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
    // load() is async: summary state updates only run after the awaited
    // request resolves, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Ticking countdown for the 60s resend cooldown (429 OTP_COOLDOWN gives
  // us the exact retry window).
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (cooldown > 0) return;

    setSending(true);
    setError("");
    setNotice("");

    try {
      const result = await sendPhoneOtp(phone);
      setStage("code-sent");
      setNotice(`Code sent to ${result.destination} — it expires in 10 minutes.`);
      setCooldown(result.resendInSeconds);
      setCode("");
      // Focus the code box once it renders.
      setTimeout(() => codeInputRef.current?.focus(), 0);
    } catch (sendError) {
      if (
        sendError instanceof VerificationApiError &&
        sendError.code === "OTP_COOLDOWN"
      ) {
        // The service tells us exactly how long to wait — keep the button
        // honest instead of letting the buyer hammer send.
        setCooldown(sendError.retryInSeconds ?? 60);
      }
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send your code — try again.",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    setConfirming(true);
    setError("");
    setNotice("");

    try {
      await confirmPhoneOtp(code);
      setStage("idle");
      setCode("");
      setNotice("Phone number verified — you can now place orders.");
      await load();
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : "That code did not work — try again.",
      );
      if (
        confirmError instanceof VerificationApiError &&
        (confirmError.code === "OTP_LOCKED" ||
          confirmError.code === "OTP_EXPIRED")
      ) {
        setStage("idle");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div
        className={`rounded-3xl border border-line bg-surface p-4 sm:p-6 ${className}`}
        aria-busy="true"
      >
        <p className="text-sm text-ink-muted">Loading verification…</p>
      </div>
    );
  }

  const verified = summary?.phone.verified ?? false;

  return (
    <section
      aria-label="Phone verification"
      className={`rounded-3xl border border-line bg-surface p-4 sm:p-6 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">
            Phone verification
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            {verified
              ? "Your number is confirmed. Orders are good to go."
              : "Verify your number to place orders. You can browse, search and cart freely without it."}
          </p>
        </div>
        <span
          className={
            verified
              ? "shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800"
              : "shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800"
          }
        >
          {verified ? "Verified" : "Not verified"}
        </span>
      </div>

      {verified ? (
        <p className="mt-4 text-sm text-ink-muted">
          Verified number:{" "}
          <span className="font-bold text-ink">{summary?.phone.number}</span>
        </p>
      ) : (
        <form onSubmit={stage === "idle" ? handleSend : handleConfirm} className="mt-5">
          <label htmlFor="otp-phone" className={LABEL}>
            Mobile number
          </label>
          <input
            id="otp-phone"
            type="tel"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="082 123 4567"
            disabled={stage === "code-sent"}
            className={`${FIELD} disabled:cursor-not-allowed disabled:bg-page`}
          />

          {stage === "code-sent" ? (
            <div className="mt-4">
              <label htmlFor="otp-code" className={LABEL}>
                6-digit code
              </label>
              <input
                id="otp-code"
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                placeholder="123456"
                className={`${FIELD} text-center text-lg font-black tracking-[0.5em]`}
              />
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}

          {notice ? (
            <p
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {notice}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={
                sending ||
                confirming ||
                (stage === "code-sent" && code.length !== 6) ||
                (stage === "idle" && cooldown > 0)
              }
              className="rounded-xl bg-[#17633a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stage === "idle"
                ? sending
                  ? "Sending…"
                  : cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : "Send code"
                : confirming
                  ? "Confirming…"
                  : "Confirm code"}
            </button>

            {stage === "code-sent" ? (
              <button
                type="button"
                onClick={() => {
                  setStage("idle");
                  setCode("");
                  setError("");
                }}
                className="text-sm font-semibold text-ink-muted underline-offset-4 hover:underline"
              >
                Change number
              </button>
            ) : null}
          </div>

          <p className="mt-3 text-xs leading-5 text-ink-muted">
            We email the code to your sign-in address — it is the verified
            channel we have for your account.
          </p>
        </form>
      )}
    </section>
  );
}
