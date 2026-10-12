"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type VerifyStatus = "loading" | "success" | "error";
type ResendStatus = "idle" | "sending" | "sent" | "failed";

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

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // Tokens are single-use. React runs effects twice in development, so this
  // ref makes sure the API is only called once per page load.
  const startedRef = useRef(false);

  const [status, setStatus] = useState<VerifyStatus>(
    token ? "loading" : "error",
  );
  const [message, setMessage] = useState(
    token ? "" : "This verification link is missing its token.",
  );

  const [email, setEmail] = useState("");
  const [resendStatus, setResendStatus] = useState<ResendStatus>("idle");
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    if (!token || startedRef.current) return;
    startedRef.current = true;

    const currentToken = token;

    const run = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(currentToken)}`,
        );
        const data: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          setStatus("error");
          setMessage(
            response.status === 401
              ? "This link is invalid, has expired, or has already been used. If you have already verified your email, you can sign in. Otherwise, request a new link below."
              : readMessage(data, "Verification failed. Please try again."),
          );
          return;
        }

        setStatus("success");
        setMessage(readMessage(data, "Your email address has been verified."));
      } catch {
        setStatus("error");
        setMessage(
          "Unable to reach the server. Check your connection and try again.",
        );
      }
    };

    void run();
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResendStatus("sending");
    setResendMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/resend-verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setResendStatus("failed");
        setResendMessage(
          readMessage(data, "Unable to send a new verification email."),
        );
        return;
      }

      setResendStatus("sent");
      setResendMessage(
        readMessage(data, "A new verification email has been sent."),
      );
    } catch {
      setResendStatus("failed");
      setResendMessage(
        "Unable to reach the server. Check your connection and try again.",
      );
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md">
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            ← Back to BonAgri
          </Link>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">
            Email verification
          </h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {status === "loading" ? (
            <p role="status" className="text-sm text-slate-600">
              Verifying your email address...
            </p>
          ) : null}

          {status === "success" ? (
            <div>
              <div
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                {message}
              </div>
              <Link
                href="/login"
                className="mt-5 block w-full rounded-lg bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Continue to sign in
              </Link>
            </div>
          ) : null}

          {status === "error" ? (
            <div>
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {message}
              </div>

              <Link
                href="/login"
                className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                Go to sign in
              </Link>

              <form
                onSubmit={handleResend}
                className="mt-6 space-y-4 border-t border-slate-200 pt-6"
              >
                <p className="text-sm font-medium text-slate-900">
                  Send a new verification link
                </p>

                {resendStatus === "sent" ? (
                  <div
                    role="status"
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                  >
                    {resendMessage}
                  </div>
                ) : null}

                {resendStatus === "failed" ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  >
                    {resendMessage}
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
                  disabled={resendStatus === "sending"}
                  className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resendStatus === "sending"
                    ? "Sending..."
                    : "Send new verification email"}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-6 py-12">
          <p className="mx-auto max-w-md text-sm text-slate-600">Loading...</p>
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
