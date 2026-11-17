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
import { clearAuth, saveAuth, savePreAuthToken } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "TRANSPORTER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
};

// HP2: most roles still get a plain session, but an ADMIN password login
// never yields a JWT — it comes back with a pre-auth token and one of the
// two two-step flags (code entry vs. mandatory enrolment).
type LoginResponse = {
  accessToken?: string;
  twoFactorRequired?: boolean;
  twoFactorSetupRequired?: boolean;
  preAuthToken?: string;
  user?: SessionUser;
};

type VerifyResponse = {
  accessToken?: string;
  user?: SessionUser;
};

type ApiReply = LoginResponse | VerifyResponse | { message?: string } | null;

function replyMessage(data: ApiReply, fallback: string): string {
  return data && "message" in data && data.message ? data.message : fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // HP2 step 2: the code step holds the pre-auth token from step 1 in
  // state (a refresh restarts the login — the token dies with it anyway).
  const [step, setStep] = useState<"password" | "code">("password");
  const [preAuthToken, setPreAuthToken] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  /*
   * Mobile only: start on the form so tapping "Sign in" from the guest screen
   * goes straight to the real login. The welcome panel stays reachable via
   * the form's back arrow.
   */
  const [showForm, setShowForm] = useState(true);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  function pushForRole(role: SessionUser["role"]) {
    if (role === "SUPPLIER" || role === "AGRO_DEALER") {
      router.push("/supplier");
      return;
    }

    if (role === "TRANSPORTER") {
      router.push("/transport");
      return;
    }

    if (role === "ADMIN") {
      router.push("/admin");
      return;
    }

    router.push("/");
  }

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

      const data = (await response.json().catch(() => null)) as ApiReply;

      if (!response.ok) {
        throw new Error(replyMessage(data, "Invalid email or password"));
      }

      // HP2: the admin two-step handshake — branch before touching tokens.
      // Both two-step replies carry a pre-auth token; the enrolment reply
      // sets twoFactorSetupRequired WITHOUT twoFactorRequired, so narrow on
      // the token and accept either flag.
      if (
        data &&
        "preAuthToken" in data &&
        (data.twoFactorRequired || data.twoFactorSetupRequired)
      ) {
        if (!data.preAuthToken) {
          throw new Error("Sign-in step incomplete — please try again");
        }

        if (data.twoFactorSetupRequired) {
          // First admin sign-in: mandatory enrolment lives on the security
          // screen, which picks the token up from sessionStorage. Drop any
          // session left by a previous user first — otherwise AuthGuard sees
          // the old identity and bounces the hand-off away from enrolment.
          clearAuth();
          savePreAuthToken(data.preAuthToken);
          router.push("/admin/security");
          return;
        }

        setPreAuthToken(data.preAuthToken);
        setStep("code");
        setCode("");
        setUseRecovery(false);
        window.requestAnimationFrame(() => codeRef.current?.focus());
        return;
      }

      if (!data || !("accessToken" in data) || !data.accessToken || !data.user) {
        throw new Error("Login succeeded but no access token was returned");
      }

      saveAuth(data.accessToken, rememberMe, data.user.id);
      pushForRole(data.user.role);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to sign in",
      );
    } finally {
      setLoading(false);
    }
  }

  // HP2 step 2 submit: pre-auth token + TOTP (or a recovery code) → JWT.
  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/2fa/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${preAuthToken}`,
        },
        body: JSON.stringify({ code }),
      });

      const data = (await response.json().catch(() => null)) as ApiReply;

      if (!response.ok) {
        const message = replyMessage(data, "Invalid authentication code");

        // A wrong code keeps you on this step; a dead sign-in window
        // (expired/superseded token) sends you back to the password step.
        if (/sign-in token/i.test(message)) {
          setStep("password");
          setPreAuthToken("");
          setCode("");
        }

        throw new Error(message);
      }

      if (!data || !("accessToken" in data) || !data.accessToken || !data.user) {
        throw new Error("Sign-in succeeded but no session was returned");
      }

      saveAuth(data.accessToken, rememberMe, data.user.id);
      pushForRole(data.user.role);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to sign in",
      );
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setStep("password");
    setPreAuthToken("");
    setCode("");
    setUseRecovery(false);
    setError("");
    window.requestAnimationFrame(() => emailRef.current?.focus());
  }

  function toggleRecovery() {
    setUseRecovery((current) => !current);
    setCode("");
    setError("");
  }

  function openForm() {
    setShowForm(true);
    window.requestAnimationFrame(() => emailRef.current?.focus());
  }

  const errorAlert = error ? (
    <div
      role="alert"
      className="mx-auto w-fit max-w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-xs font-medium text-red-700"
    >
      {error}
    </div>
  ) : null;

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
          {step === "password" ? (
            <>
              <div className="text-center">
                <h2 className={`${DISPLAY} text-4xl font-extrabold text-[#17633a]`}>
                  welcome
                </h2>
                <p className="mt-1 text-[13px] text-[#5b7a68]">
                  Log in to your account to continue
                </p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {errorAlert}

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

                {/* HP4: account recovery — only on the password step; the
                    two-step code screen has no password to reset. */}
                <div className="pt-1 text-center">
                  <Link
                    href="/forgot-password"
                    className="text-[12px] font-semibold text-[#17633a]/70 underline-offset-2 transition hover:text-[#2d9d5e] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>

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
            </>
          ) : (
            <>
              <div className="text-center">
                <h2 className={`${DISPLAY} text-4xl font-extrabold text-[#17633a]`}>
                  2-step
                </h2>
                <p className="mt-1 text-[13px] text-[#5b7a68]">
                  {useRecovery
                    ? "Enter one of your single-use recovery codes"
                    : "Enter the 6-digit code from your authenticator app"}
                </p>
              </div>

              <form onSubmit={handleVerify} className="mt-8 space-y-4">
                {errorAlert}

                <PillField
                  id="two-factor-code"
                  type="text"
                  autoComplete="one-time-code"
                  label={useRecovery ? "Recovery code" : "Authentication code"}
                  value={code}
                  onChange={setCode}
                  inputRef={codeRef}
                />

                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={toggleRecovery}
                    className="text-[12px] font-semibold text-[#17633a]/70 underline-offset-2 transition hover:text-[#2d9d5e] hover:underline"
                  >
                    {useRecovery
                      ? "Use authenticator app instead"
                      : "Use a recovery code instead"}
                  </button>
                </div>

                <div className="pt-2 text-center">
                  <button
                    type="submit"
                    disabled={loading}
                    className={`${DISPLAY} mx-auto block w-[62%] max-w-[240px] rounded-full bg-[#2d9d5e] py-3 text-sm font-bold tracking-[0.2em] text-white shadow-lg shadow-[#2d9d5e]/30 transition hover:bg-[#248a50] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {loading ? "VERIFYING..." : "VERIFY"}
                  </button>
                </div>
              </form>

              <p className="mt-8 text-center text-sm text-slate-600">
                <button
                  type="button"
                  onClick={backToPassword}
                  className="font-bold text-[#17633a] transition hover:text-[#2d9d5e]"
                >
                  back to sign in
                </button>
              </p>
            </>
          )}
        </FormPanel>
      </div>
      <AuthThemeToggle />
    </main>
  );
}
