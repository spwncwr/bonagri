"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { BottomSplash } from "../../components/auth/auth-screens";
import { BrandLogo } from "../../components/brand/logo";
import { ArrowLeftIcon } from "../../components/mobile/icons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type ResetStatus = "idle" | "saving" | "done" | "expired" | "failed";

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

// HP4: step two of account recovery. The single-use token arrives in the
// link's query string, is held in component state only (never persisted) and
// is burned by the API on success — so a reload of this page after resetting
// shows the "link no longer valid" state, not a second chance.
function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<ResetStatus>(
    token ? "idle" : "expired",
  );
  const [message, setMessage] = useState(
    token ? "" : "This reset link is missing its token.",
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setStatus("failed");
      setMessage("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setStatus("failed");
      setMessage("Password must be at least 8 characters");
      return;
    }

    setStatus("saving");
    setMessage("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auth/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        },
      );
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        // 400 = the link itself is dead (unknown, expired or already used —
        // the API gives the same generic answer for all three). There is
        // nothing to retry here; the user needs a fresh link.
        if (response.status === 400) {
          setStatus("expired");
          setMessage(
            readMessage(
              data,
              "This reset link is invalid or has expired.",
            ),
          );
          return;
        }

        setStatus("failed");
        setMessage(
          response.status === 429
            ? "Too many attempts — please wait a minute and try again."
            : readMessage(
                data,
                "Unable to update your password right now. Please try again.",
              ),
        );
        return;
      }

      // Drop the new password from memory the moment it is accepted.
      setPassword("");
      setConfirmPassword("");
      setStatus("done");
      setMessage(
        readMessage(
          data,
          "Password updated. You can now sign in with your new password.",
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
            Choose a new password
          </h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {status === "done" ? (
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
                Sign in with your new password
              </Link>
            </div>
          ) : status === "expired" ? (
            <div>
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {message}
              </div>

              <Link
                href="/forgot-password"
                className="mt-5 block w-full rounded-lg bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Request a new reset link
              </Link>

              <Link
                href="/login"
                className="mt-4 block text-center text-sm font-medium text-emerald-700 transition hover:text-emerald-800"
              >
                Back to sign in
              </Link>
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
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="At least 8 characters"
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Confirm new password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Repeat the new password"
                />
              </div>

              <button
                type="submit"
                disabled={status === "saving"}
                className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "saving" ? "Updating..." : "Set new password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 px-6 py-12">
          <p className="mx-auto max-w-md text-sm text-slate-600">Loading...</p>
        </main>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
