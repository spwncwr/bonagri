"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { BottomSplash } from "../../components/auth/auth-screens";
import { BrandLogo } from "../../components/brand/logo";
import { ArrowLeftIcon } from "../../components/mobile/icons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type ForgotStatus = "idle" | "sending" | "sent" | "failed";

function readMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return fallback;
}

// HP4: step one of account recovery. The API answers the same 202 for every
// address (no account enumeration), and this screen repeats that promise —
// one fixed confirmation, whatever the outcome was server-side.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<ForgotStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/forgot-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus("failed");
        setMessage(
          response.status === 429
            ? "Too many reset requests — please wait a minute and try again."
            : readMessage(
                data,
                "Unable to send a reset link right now. Please try again.",
              ),
        );
        return;
      }

      setStatus("sent");
      setMessage(
        readMessage(
          data,
          "If an account exists for that email, a password reset link has been sent.",
        ),
      );
    } catch {
      setStatus("failed");
      setMessage(
        "Unable to reach the server. Check your connection and try again.",
      );
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50 px-6 py-12">
      {/* Mobile: soft mint splash along the bottom edge (auth design accent). */}
      <BottomSplash tone="mint" />

      <div className="relative z-10 mx-auto max-w-md">
        <div className="mb-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            <ArrowLeftIcon className="h-4 w-4" strokeWidth={2.2} />
            Back to sign in
          </Link>

          <div className="mt-6">
            <BrandLogo height={28} />
          </div>

          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
            Forgot your password?
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter the email you signed up with and we&apos;ll send you a link
            to choose a new one.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {status === "sent" ? (
            <div>
              <div
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                {message}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                The link expires in 30 minutes. Nothing after a few minutes?
                Check your spam folder, or make sure you used the address you
                registered with.
              </p>

              <Link
                href="/login"
                className="mt-5 block w-full rounded-lg bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Continue to sign in
              </Link>

              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                  setMessage("");
                }}
                className="mt-4 w-full text-center text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {status === "failed" ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {message}
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "sending" ? "Sending..." : "Email me a reset link"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
