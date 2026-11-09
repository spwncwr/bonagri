"use client";

// The account half of every settings screen: display picture, name, contact
// number and the sign-in address (read-only — it would need re-verification
// to change). Shared by the supplier desk and the transporter's profile tab
// so all roles edit the same row through PATCH /api/profile/me.
import { useState } from "react";
import ImageUpload from "../media/image-upload";
import { authHeaders, type AuthUser } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const FIELD =
  "mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none";
const LABEL =
  "block text-xs font-bold uppercase tracking-wide text-[#7b867d]";

function readError(data: unknown): string {
  const payload = data as { message?: string | string[] } | null;
  const message = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : payload?.message;
  return message || "Could not save your profile — try again.";
}

type Props = {
  user: AuthUser;
  /**
   * Input-id prefix. The transporter profile tab renders this card twice
   * (phone branch and desk branch are both in the DOM), so ids must not
   * collide.
   */
  idPrefix?: string;
  /** Hands the saved account back so the screen can refresh its copy. */
  onSaved: (user: AuthUser) => void;
};

export default function AccountSettings({
  user,
  idPrefix = "settings",
  onSaved,
}: Props) {
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/me`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readError(data));
      }

      setNotice("Profile saved.");
      onSaved({ ...user, ...(data as Partial<AuthUser>) });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your profile — try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      aria-label="Account details"
      className="rounded-3xl border border-line bg-surface p-4 sm:p-6"
    >
      <h2 className="text-lg font-black tracking-tight text-ink">
        Your details
      </h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        How BonAgri greets you and how buyers and suppliers reach you.
      </p>

      <div className="mt-5">
        <span className={LABEL}>Display picture</span>
        <div className="mt-2">
          <ImageUpload kind="avatar" value={avatarUrl} onChange={setAvatarUrl} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-first-name`} className={LABEL}>
            First name
          </label>
          <input
            id={`${idPrefix}-first-name`}
            type="text"
            required
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-last-name`} className={LABEL}>
            Last name
          </label>
          <input
            id={`${idPrefix}-last-name`}
            type="text"
            required
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-phone`} className={LABEL}>
            Contact number
          </label>
          <input
            id={`${idPrefix}-phone`}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="072 000 0000"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor={`${idPrefix}-email`} className={LABEL}>
            Sign-in email
          </label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            value={user.email}
            readOnly
            aria-describedby={`${idPrefix}-email-hint`}
            className={`${FIELD} cursor-not-allowed bg-page text-ink-muted`}
          />
          <p
            id={`${idPrefix}-email-hint`}
            className="mt-1.5 text-xs leading-5 text-ink-muted"
          >
            Your login address — contact support to change it.
          </p>
        </div>
      </div>

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

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[#17633a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save details"}
        </button>
      </div>
    </form>
  );
}
