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
import { saveAuth } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "TRANSPORTER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /*
   * Mobile only: start on the form so tapping "Sign in" from the guest screen
   * goes straight to the real login. The welcome panel stays reachable via
   * the form's back arrow.
   */
  const [showForm, setShowForm] = useState(true);
  const emailRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | LoginResponse
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          data && "message" in data && data.message
            ? data.message
            : "Invalid email or password",
        );
      }

      if (!data || !("accessToken" in data) || !data.accessToken) {
        throw new Error("Login succeeded but no access token was returned");
      }

      saveAuth(data.accessToken, rememberMe, data.user.id);

      if (data.user.role === "SUPPLIER" || data.user.role === "AGRO_DEALER") {
        router.push("/supplier");
        return;
      }

      if (data.user.role === "TRANSPORTER") {
        router.push("/transport");
        return;
      }

      if (data.user.role === "ADMIN") {
        router.push("/admin");
        return;
      }

      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to sign in",
      );
    } finally {
      setLoading(false);
    }
  }

  function openForm() {
    setShowForm(true);
    window.requestAnimationFrame(() => emailRef.current?.focus());
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
          headline="Welcome Back!"
          sublines={[
            "To stay connected with us",
            "please login with your personal info",
          ]}
          ctaLabel="SIGN IN"
          onCta={openForm}
        />

        <FormPanel onBack={() => setShowForm(false)}>
          <div className="text-center">
            <h2 className={`${DISPLAY} text-4xl font-extrabold text-[#17633a]`}>
              welcome
            </h2>
            <p className="mt-1 text-[13px] text-[#5b7a68]">
              Log in to your account to continue
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

            <PillField
              id="email"
              type="email"
              autoComplete="email"
              label="Email"
              value={email}
              onChange={setEmail}
              inputRef={emailRef}
            />

            <PillField
              id="password"
              type="password"
              autoComplete="current-password"
              label="Password"
              value={password}
              onChange={setPassword}
            />

            <div className="flex items-center justify-center gap-2 pt-1">
              <input
                id="remember-me"
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#17633a]/40 accent-[#2d9d5e]"
              />
              <label
                htmlFor="remember-me"
                className="cursor-pointer text-[11px] font-medium text-[#17633a]/70"
              >
                Remember me
              </label>
            </div>

            <div className="pt-2 text-center">
              <button
                type="submit"
                disabled={loading}
                className={`${DISPLAY} mx-auto block w-[62%] max-w-[240px] rounded-full bg-[#2d9d5e] py-3 text-sm font-bold tracking-[0.2em] text-white shadow-lg shadow-[#2d9d5e]/30 transition hover:bg-[#248a50] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loading ? "SIGNING IN..." : "LOG IN"}
              </button>
            </div>
          </form>

          <p className="mt-8 text-center text-sm text-slate-600">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-bold text-[#17633a] transition hover:text-[#2d9d5e]"
            >
              sign up
            </Link>
          </p>
        </FormPanel>
      </div>
      <AuthThemeToggle />
    </main>
  );
}
