"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import {
  AuthThemeToggle,
  authDisplay,
  DISPLAY,
  FormPanel,
  PillField,
  WelcomePanel,
} from "../../components/auth/auth-screens";
import { CheckIcon } from "../../components/mobile/icons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type RegisterResponse = {
  message?: string | string[];
  emailVerificationRequired?: boolean;
};

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  /* Mobile lands straight on the form (same as /login) — the welcome screen
     stays reachable through the form's back arrow. */
  const [showForm, setShowForm] = useState(true);
  const firstNameRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone: phone.trim() === "" ? undefined : phone.trim(),
          password,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | RegisterResponse
        | null;

      if (!response.ok) {
        const apiMessage =
          data && data.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : null;

        throw new Error(apiMessage ?? "Unable to create your account");
      }

      setRegistered(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create your account",
      );
    } finally {
      setLoading(false);
    }
  }

  function openForm() {
    setShowForm(true);
    window.requestAnimationFrame(() => firstNameRef.current?.focus());
  }

  return (
    <main
      className={`${authDisplay.variable} min-h-screen overflow-x-hidden bg-white`}
    >
      {/* Two panels side-by-side on wide screens; swipeable screens on phones. */}
      <div
        className={`flex min-h-screen w-full transition-transform duration-500 ease-in-out lg:translate-x-0 ${
          showForm ? "-translate-x-full" : "translate-x-0"
        }`}
      >
        <WelcomePanel
          headline="Welcome!"
          sublines={[
            "To create your account",
            "please fill in your personal info",
          ]}
          ctaLabel="SIGN UP"
          onCta={openForm}
        />

        <FormPanel onBack={() => setShowForm(false)}>
          {registered ? (
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e7f5ec]">
                <CheckIcon
                  className="h-7 w-7 text-[#17633a]"
                  strokeWidth={3}
                />
              </div>

              <h2
                className={`${DISPLAY} mt-5 text-3xl font-extrabold text-[#17633a]`}
              >
                Check your email
              </h2>

              <p className="mt-3 text-sm text-slate-600">
                We sent a verification link to{" "}
                <span className="font-semibold text-slate-900">{email}</span>.
                Click it to activate your account — the link expires in 24
                hours.
              </p>

              <p className="mt-2 text-xs text-slate-500">
                Nothing after a few minutes? Look in your spam folder.
              </p>

              <button
                type="button"
                onClick={() => router.push("/login")}
                className={`${DISPLAY} mx-auto mt-7 block w-[62%] max-w-[240px] rounded-full bg-[#2d9d5e] py-3 text-sm font-bold tracking-[0.2em] text-white shadow-lg shadow-[#2d9d5e]/30 transition hover:bg-[#248a50] active:scale-[0.98]`}
              >
                GO TO SIGN IN
              </button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h2
                  className={`${DISPLAY} text-4xl font-extrabold text-[#17633a]`}
                >
                  sign up
                </h2>
                <p className="mt-1 text-[13px] text-[#5b7a68]">
                  Create your account to continue
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {error ? (
                  <div
                    role="alert"
                    className="mx-auto w-fit max-w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-xs font-medium text-red-700"
                  >
                    {error}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <PillField
                    id="firstName"
                    type="text"
                    autoComplete="given-name"
                    label="First name"
                    value={firstName}
                    onChange={setFirstName}
                    inputRef={firstNameRef}
                  />

                  <PillField
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    label="Last name"
                    value={lastName}
                    onChange={setLastName}
                  />
                </div>

                <PillField
                  id="email"
                  type="email"
                  autoComplete="email"
                  label="Email"
                  value={email}
                  onChange={setEmail}
                />

                <PillField
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  label="Phone (optional)"
                  value={phone}
                  onChange={setPhone}
                  required={false}
                />

                <PillField
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  minLength={8}
                />

                <PillField
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  label="Confirm password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  minLength={8}
                />

                <div className="pt-2 text-center">
                  <button
                    type="submit"
                    disabled={loading}
                    className={`${DISPLAY} mx-auto block w-[72%] max-w-[280px] rounded-full bg-[#2d9d5e] py-3 text-sm font-bold tracking-[0.16em] text-white shadow-lg shadow-[#2d9d5e]/30 transition hover:bg-[#248a50] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
                  </button>
                </div>
              </form>

              <p className="mt-8 text-center text-sm text-slate-600">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-bold text-[#17633a] transition hover:text-[#2d9d5e]"
                >
                  sign in
                </Link>
              </p>
            </>
          )}
        </FormPanel>
      </div>
      <AuthThemeToggle />
    </main>
  );
}
