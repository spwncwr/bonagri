"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminCard, AdminSessionSkeleton } from "../../../components/admin/admin-ui";
import {
  authHeaders,
  clearPreAuthToken,
  fetchCurrentUser,
  readPreAuthToken,
  saveAuth,
  type AuthUser,
} from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

// HP2: the admin 2FA console — mandatory enrolment (fed by the login
// hand-off token), the one-time recovery codes, and the disable path.
// /admin/layout already wraps this in AuthGuard(requiredRole ADMIN).

type Setup = {
  secret: string;
  otpauthUri: string;
  accountLabel: string;
};

type EnableResponse = {
  twoFactorEnabled: boolean;
  recoveryCodes?: string[];
  accessToken?: string;
};

type View = "loading" | "setup" | "codes" | "enabled" | "error";

type ApiError = { message?: string };

function replyMessage(data: ApiError | null, fallback: string): string {
  return data && data.message ? data.message : fallback;
}

const inputClass =
  "w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:bg-white/8";

const primaryButton =
  "rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50";

export default function AdminSecurityPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  // One setup request per mount: React's dev double-invoke would otherwise
  // regenerate the pending secret, and the QR the user scans would diverge
  // from the secret the API verifies codes against.
  const setupRequestRef = useRef<Promise<Setup | null> | null>(null);
  // The enrolment bearer: the pre-auth hand-off token during mandatory
  // enrolment, or null when a live session drives setup (re-enrol).
  const [enrolToken, setEnrolToken] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableUseRecovery, setDisableUseRecovery] = useState(false);

  async function requestSetup(
    headers: Record<string, string>,
  ): Promise<Setup | null> {
    const response = await fetch(`${API_BASE_URL}/api/auth/2fa/setup`, {
      method: "POST",
      headers,
    });
    if (!response.ok) return null;
    return (await response.json()) as Setup;
  }

  // Memoised per mount: both effect paths (hand-off and live session) share
  // the single request so a re-invoke reuses its result instead of minting a
  // second secret.
  function startSetup(headers: Record<string, string>): Promise<Setup | null> {
    if (!setupRequestRef.current) {
      setupRequestRef.current = requestSetup(headers);
    }
    return setupRequestRef.current;
  }

  function enrolHeaders(): Record<string, string> {
    return enrolToken
      ? { "Content-Type": "application/json", Authorization: `Bearer ${enrolToken}` }
      : { "Content-Type": "application/json", ...authHeaders() };
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // 1) Mandatory-enrolment hand-off from the login screen: the password
      //    was checked moments ago, so the pre-auth token starts setup.
      const preauth = readPreAuthToken();
      if (preauth) {
        const pending = await startSetup({
          Authorization: `Bearer ${preauth}`,
        });
        if (!cancelled && pending) {
          setEnrolToken(preauth);
          setSetup(pending);
          setView("setup");
          return;
        }
        // Expired or superseded hand-off — fall back to a live session.
        clearPreAuthToken();
      }

      // 2) Signed-in admin: re-enrol after a disable, or session carry-over.
      const me = await fetchCurrentUser();
      if (cancelled) return;
      if (!me) {
        // Dead hand-off with no session behind it — the AuthGuard lets this
        // page through on the pre-auth token alone, so bounce ourselves (the
        // token was cleared above; no loop).
        router.replace("/login");
        return;
      }
      setUser(me);

      if (me.twoFactorEnabled) {
        setView("enabled");
        return;
      }

      const pending = await startSetup(authHeaders());
      if (cancelled) return;
      if (!pending) {
        setError("Unable to start two-factor setup — sign in again and retry.");
        setView("error");
        return;
      }
      setSetup(pending);
      setView("setup");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The code proves the authenticator app scanned the secret; a mandatory
  // enrolment also completes the login here (the response carries the JWT).
  async function handleEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/2fa/enable`, {
        method: "POST",
        headers: enrolHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = (await response.json().catch(() => null)) as
        | (EnableResponse & ApiError)
        | null;

      if (!response.ok) {
        throw new Error(replyMessage(data, "Invalid authentication code"));
      }
      if (!data?.recoveryCodes?.length) {
        throw new Error("Enrolment incomplete — no recovery codes returned");
      }

      if (data.accessToken) {
        // Enrolment-as-login: persist the session the pre-auth flow earned.
        const remembered =
          localStorage.getItem("bonagri_remember_me") !== "false";
        saveAuth(data.accessToken, remembered);
        const me = await fetchCurrentUser();
        if (me) setUser(me);
      }

      clearPreAuthToken();
      setEnrolToken(null);
      setRecoveryCodes(data.recoveryCodes);
      setCodesSaved(false);
      setCode("");
      setView("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to enable 2FA");
    } finally {
      setBusy(false);
    }
  }

  // Disable re-proves the account: password AND a current code (TOTP or a
  // recovery code for the lost-device path). The mandate re-bites right
  // after — the wizard below starts again for the new enrolment.
  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/2fa/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          password: disablePassword,
          code: disableCode,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | ApiError
        | null;

      if (!response.ok) {
        throw new Error(replyMessage(data, "Unable to disable 2FA"));
      }

      setDisableOpen(false);
      setDisablePassword("");
      setDisableCode("");
      setDisableUseRecovery(false);

      const pending = await requestSetup(authHeaders());
      if (!pending) {
        throw new Error("2FA is off but re-enrolment could not start");
      }
      setSetup(pending);
      setView("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard denied — the values stay selectable on screen.
    }
  }

  if (view === "loading") {
    return <AdminSessionSkeleton />;
  }

  if (view === "error") {
    return (
      <div className="space-y-4">
        <PageHeader />
        <AdminCard title="Setup could not start">
          <p className="text-sm text-slate-400">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`${primaryButton} mt-4`}
          >
            Try again
          </button>
        </AdminCard>
      </div>
    );
  }

  if (view === "setup" && setup) {
    const mandatory = Boolean(enrolToken);

    return (
      <div className="space-y-4">
        <PageHeader />

        {mandatory ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-200">
            Your password was verified — now secure this admin account. Two-factor
            is mandatory: sign-in needs a code from your authenticator app.
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300"
          >
            {error}
          </div>
        ) : null}

        <AdminCard title="Scan the QR code">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-2xl bg-white p-4">
              <QRCodeSVG
                value={setup.otpauthUri}
                size={168}
                bgColor="#ffffff"
                fgColor="#0b1f16"
                level="M"
              />
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-sm leading-6 text-slate-400">
                Open Google Authenticator, 1Password, Authy or any TOTP app,
                scan this code, then enter the 6-digit code it shows below.
              </p>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Or enter the key manually
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl bg-white/5 px-3 py-2 font-mono text-sm tracking-widest text-emerald-300">
                    {setup.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyText(setup.secret)}
                    className="shrink-0 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/12"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Account: {setup.accountLabel}
              </p>
            </div>
          </div>
        </AdminCard>

        <AdminCard title="Confirm with a code">
          <form onSubmit={handleEnable} className="max-w-sm space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={10}
              className={`${inputClass} font-mono tracking-[0.4em]`}
            />
            <button
              type="submit"
              disabled={busy || code.trim().length < 6}
              className={primaryButton}
            >
              {busy ? "Enabling..." : "Enable two-factor"}
            </button>
          </form>
        </AdminCard>
      </div>
    );
  }

  if (view === "codes") {
    return (
      <div className="space-y-4">
        <PageHeader />

        <AdminCard title="Save your recovery codes">
          <p className="text-sm leading-6 text-slate-400">
            Each code signs you in exactly once if you lose your authenticator
            app. They are shown <strong className="text-slate-200">once</strong> —
            store them somewhere safe (password manager, printed copy).
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
            {recoveryCodes.map((recoveryCode) => (
              <code
                key={recoveryCode}
                className="rounded-xl bg-white/5 px-3 py-2 text-center font-mono text-sm tracking-wider text-emerald-300"
              >
                {recoveryCode}
              </code>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                void copyText(recoveryCodes.join("\n"))
              }
              className="rounded-xl border border-white/10 bg-white/6 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/12"
            >
              {copied ? "Copied" : "Copy all"}
            </button>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={codesSaved}
                onChange={(event) => setCodesSaved(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 accent-emerald-500"
              />
              I have saved these codes
            </label>

            <button
              type="button"
              disabled={!codesSaved}
              onClick={() => setView("enabled")}
              className={`${primaryButton} ml-auto`}
            >
              Continue
            </button>
          </div>
        </AdminCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader />

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300"
        >
          {error}
        </div>
      ) : null}

      <AdminCard>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/18 text-2xl text-emerald-300">
            ✓
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-white">
              Two-factor authentication is ON
            </p>
            <p className="text-sm text-slate-400">
              {user?.email ?? "This admin account"} signs in with a password
              plus a one-time code. A sign-in alert email is sent on every
              completed login.
            </p>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="Turn off two-factor">
        <p className="text-sm leading-6 text-slate-400">
          Disabling requires your password and a current code (or a recovery
          code if your device is lost). You will be asked to enrol again on
          your next sign-in.
        </p>

        {!disableOpen ? (
          <button
            type="button"
            onClick={() => setDisableOpen(true)}
            className="mt-4 rounded-full border border-red-400/30 bg-red-500/10 px-5 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
          >
            Disable two-factor
          </button>
        ) : (
          <form onSubmit={handleDisable} className="mt-4 max-w-sm space-y-3">
            <div>
              <label
                htmlFor="disable-password"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500"
              >
                Password
              </label>
              <input
                id="disable-password"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="disable-code"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500"
              >
                {disableUseRecovery ? "Recovery code" : "Authentication code"}
              </label>
              <input
                id="disable-code"
                type="text"
                inputMode={disableUseRecovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                placeholder={disableUseRecovery ? "XXXXXXXXXXXX" : "123456"}
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
                maxLength={20}
                className={`${inputClass} font-mono tracking-[0.3em]`}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setDisableUseRecovery((current) => !current);
                  setDisableCode("");
                }}
                className="text-xs font-semibold text-slate-400 underline-offset-2 transition hover:text-emerald-300 hover:underline"
              >
                {disableUseRecovery
                  ? "Use authenticator app instead"
                  : "Use a recovery code instead"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDisableOpen(false);
                  setError("");
                }}
                className="text-xs font-semibold text-slate-400 transition hover:text-white"
              >
                Cancel
              </button>
            </div>

            <button
              type="submit"
              disabled={
                busy || disablePassword.length < 8 || disableCode.trim().length < 6
              }
              className={primaryButton}
            >
              {busy ? "Disabling..." : "Confirm and disable"}
            </button>
          </form>
        )}
      </AdminCard>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight text-white">
        Admin security
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Mandatory two-factor authentication for admin accounts, plus the
        recovery codes that keep you signed in if your device is lost.
      </p>
    </div>
  );
}
