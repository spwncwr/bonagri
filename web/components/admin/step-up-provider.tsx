"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authHeaders } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type StepUpFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const StepUpContext = createContext<StepUpFetch | null>(null);

// HP3 (plan G3): every guarded admin mutation answers 403 with the machine
// code STEP_UP_REQUIRED until the caller re-proves the password. This
// provider turns that handshake into one transparent retry: prompt →
// POST /auth/step-up → replay once with X-Step-Up. Reads never hit the
// guard, so they pass straight through.

function isStepUpRequired(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return Promise.resolve(false);
  }
  // clone() keeps the original body readable for the caller if we hand it
  // back unchanged.
  return response.clone().json().then(
    (body) => (body as { code?: string } | null)?.code === "STEP_UP_REQUIRED",
    () => false,
  );
}

function withStepUpHeader(
  init: RequestInit | undefined,
  token: string,
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("X-Step-Up", token);
  return { ...init, headers };
}

type PromptState = {
  error: string;
  busy: boolean;
};

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  // HP3: the step-up token lives ONLY in this ref — never localStorage,
  // sessionStorage or a cookie — and dies with the tab. The server TTL is
  // 5 minutes; we stop trusting it 30s early so a retry can never race the
  // expiry.
  const cachedToken = useRef<{ token: string; expiresAt: number } | null>(
    null,
  );
  // Concurrent mutations that both need confirmation share ONE prompt.
  const waiter = useRef<Promise<string | null> | null>(null);
  const resolver = useRef<((password: string | null) => void) | null>(null);

  const requestPassword = useCallback((error: string) => {
    if (!waiter.current) {
      setPrompt({ error, busy: false });
      waiter.current = new Promise<string | null>((resolve) => {
        resolver.current = (password) => {
          waiter.current = null;
          resolver.current = null;
          resolve(password);
        };
      });
    } else if (error) {
      // A failed attempt keeps the open dialog and swaps in the new message.
      setPrompt((current) =>
        current ? { ...current, error, busy: false } : current,
      );
    }
    return waiter.current;
  }, []);

  const cancelPrompt = useCallback(() => {
    const resolve = resolver.current;
    setPrompt(null);
    resolve?.(null);
  }, []);

  const submitPassword = useCallback((password: string) => {
    const resolve = resolver.current;
    if (!resolve) {
      return;
    }
    setPrompt((current) =>
      current ? { ...current, busy: true, error: "" } : current,
    );
    resolve(password);
  }, []);

  const stepUpFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetch(input, init);
      if (!(await isStepUpRequired(response))) {
        return response;
      }

      // A cached token inside its TTL may open the door silently — the
      // server treats it as reusable within the 5-minute window.
      const cached = cachedToken.current;
      if (cached && cached.expiresAt > Date.now()) {
        const retry = await fetch(input, withStepUpHeader(init, cached.token));
        if (!(await isStepUpRequired(retry))) {
          return retry;
        }
      }

      for (;;) {
        const password = await requestPassword("");
        if (password === null) {
          // Cancelled: hand back the original 403 so the caller's normal
          // error path reports it.
          return response;
        }

        const mint = await fetch(`${API_BASE_URL}/api/auth/step-up`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });

        if (mint.ok) {
          const data = (await mint.json()) as {
            stepUpToken: string;
            expiresIn: number;
          };
          cachedToken.current = {
            token: data.stepUpToken,
            expiresAt: Date.now() + (data.expiresIn - 30) * 1000,
          };
          setPrompt(null);
          return fetch(input, withStepUpHeader(init, data.stepUpToken));
        }

        const body = (await mint.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const raw = Array.isArray(body?.message)
          ? body.message.join(", ")
          : body?.message;
        const message =
          mint.status === 429
            ? "Too many confirmation attempts — wait a minute and try again."
            : mint.status === 401
              ? "That password is not correct."
              : (raw ?? "Could not confirm your password.");
        // Re-prompt with the error, but do NOT await it here: the loop top
        // awaits the same waiter. Awaiting here would swallow the password the
        // user submits next (it would be consumed by this discarded await)
        // and then wait for yet another entry, wedging the dialog.
        requestPassword(message);
      }
    },
    [requestPassword],
  );

  return (
    <StepUpContext.Provider value={stepUpFetch}>
      {children}
      {prompt ? (
        <StepUpDialog
          busy={prompt.busy}
          error={prompt.error}
          onSubmit={submitPassword}
          onCancel={cancelPrompt}
        />
      ) : null}
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpFetch {
  const stepUpFetch = useContext(StepUpContext);
  if (!stepUpFetch) {
    throw new Error("useStepUp must be used within <StepUpProvider>");
  }
  return stepUpFetch;
}

function StepUpDialog({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15151f] p-6 shadow-2xl"
      >
        <h2 id="step-up-title" className="text-lg font-bold text-white">
          Confirm it&apos;s you
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-slate-400">
          This action changes platform data. Re-enter your password to
          continue — the confirmation lasts 5 minutes.
        </p>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (password && !busy) {
              onSubmit(password);
              setPassword("");
            }
          }}
        >
          <input
            // The dialog's only task is this field — focus it on open so
            // the admin can just type their password.
            autoFocus
            type="password"
            name="password"
            autoComplete="current-password"
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-500/20"
          />

          {error ? (
            <p
              role="alert"
              className="mt-2.5 text-xs font-semibold text-red-300"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Confirming..." : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
