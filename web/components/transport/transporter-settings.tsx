"use client";

// What a transporter edits about itself: the shared account card (display
// picture, name, contact) plus the business/vehicle details and the
// provinces whose jobs it wants to see. Rendered by both branches of the
// transport Profile tab, hence the idPrefix.
import { useEffect, useState } from "react";
import AccountSettings from "../settings/account-settings";
import { authHeaders, fetchCurrentUser, type AuthUser } from "../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const FIELD =
  "mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none";
const LABEL =
  "block text-xs font-bold uppercase tracking-wide text-[#7b867d]";

const PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
];

type BusinessForm = {
  businessName: string;
  vehicleType: string;
  phone: string;
  email: string;
  city: string;
  province: string;
  serviceProvinces: string[];
};

function emptyForm(): BusinessForm {
  return {
    businessName: "",
    vehicleType: "",
    phone: "",
    email: "",
    city: "",
    province: "",
    serviceProvinces: [],
  };
}

function readError(data: unknown): string {
  const payload = data as { message?: string | string[] } | null;
  const message = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : payload?.message;
  return message || "Could not save your details — try again.";
}

function initialsOf(name: string) {
  return (name || "T").trim().charAt(0).toUpperCase();
}

export default function TransporterSettings({ idPrefix }: { idPrefix: string }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((next) => {
      if (cancelled) return;

      setUser(next);
      const profile = next?.transporterProfile ?? null;
      setForm(
        profile
          ? {
              businessName: profile.businessName,
              vehicleType: profile.vehicleType ?? "",
              phone: profile.phone ?? "",
              email: profile.email ?? "",
              city: profile.city ?? "",
              province: profile.province ?? "",
              serviceProvinces: profile.serviceProvinces,
            }
          : emptyForm(),
      );
      setVerified(profile?.verified ?? false);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function update(field: keyof BusinessForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleProvince(province: string) {
    setForm((current) => ({
      ...current,
      serviceProvinces: current.serviceProvinces.includes(province)
        ? current.serviceProvinces.filter((item) => item !== province)
        : [...current.serviceProvinces, province],
    }));
  }

  async function saveBusiness(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/transport/profile`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          vehicleType: form.vehicleType.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          city: form.city.trim() || null,
          province: form.province.trim() || null,
          serviceProvinces: form.serviceProvinces,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readError(data));
      }

      const saved = data as BusinessForm & { verified: boolean };

      setForm({
        businessName: saved.businessName ?? "",
        vehicleType: saved.vehicleType ?? "",
        phone: saved.phone ?? "",
        email: saved.email ?? "",
        city: saved.city ?? "",
        province: saved.province ?? "",
        serviceProvinces: saved.serviceProvinces ?? [],
      });
      setVerified(saved.verified ?? false);
      setNotice("Transport details saved.");

      if (user) {
        setUser({
          ...user,
          transporterProfile: {
            businessName: saved.businessName ?? "",
            vehicleType: saved.vehicleType ?? null,
            phone: saved.phone ?? null,
            email: saved.email ?? null,
            city: saved.city ?? null,
            province: saved.province ?? null,
            serviceProvinces: saved.serviceProvinces ?? [],
            verified: saved.verified ?? false,
          },
        });
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your details — try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="rounded-3xl border border-line bg-surface p-4 text-sm text-ink-muted">
        Loading your profile...
      </p>
    );
  }

  if (!user) {
    return (
      <p className="rounded-3xl border border-line bg-surface p-4 text-sm text-ink-muted">
        Your session ended — sign in again.
      </p>
    );
  }

  const displayName = `${user.firstName} ${user.lastName}`.trim();
  const businessName = form.businessName.trim();

  return (
    <div className="space-y-5">
      {/* Identity — the real account, not a generic label. */}
      <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-4 sm:p-5">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#17633a]/10 text-xl font-black text-[#17633a]">
            {initialsOf(user.firstName)}
          </div>
        )}

        <div className="min-w-0">
          <p className="truncate text-base font-black text-ink">{displayName}</p>
          <p className="truncate text-xs font-semibold text-ink-muted">
            {businessName || "Add your business name below"}
          </p>
        </div>

        <span
          className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
            verified
              ? "bg-[#e8f1e6] text-[#17633a]"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {verified ? "VERIFIED" : "PENDING REVIEW"}
        </span>
      </div>

      <AccountSettings
        user={user}
        idPrefix={idPrefix}
        onSaved={(next) => setUser(next)}
      />

      <form
        onSubmit={(event) => void saveBusiness(event)}
        aria-label="Transport details"
        className="rounded-3xl border border-line bg-surface p-4 sm:p-6"
      >
        <h2 className="text-lg font-black tracking-tight text-ink">
          Transport details
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          How buyers and the dispatch team identify and reach you.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-business-name`} className={LABEL}>
              Business name
            </label>
            <input
              id={`${idPrefix}-business-name`}
              type="text"
              required
              value={form.businessName}
              onChange={(event) => update("businessName", event.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={`${idPrefix}-vehicle`} className={LABEL}>
              Vehicle type
            </label>
            <input
              id={`${idPrefix}-vehicle`}
              type="text"
              value={form.vehicleType}
              onChange={(event) => update("vehicleType", event.target.value)}
              placeholder="e.g. 3-ton truck, bakkie"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={`${idPrefix}-business-phone`} className={LABEL}>
              Business phone
            </label>
            <input
              id={`${idPrefix}-business-phone`}
              type="tel"
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="072 000 0000"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={`${idPrefix}-business-email`} className={LABEL}>
              Business email
            </label>
            <input
              id={`${idPrefix}-business-email`}
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              placeholder="jobs@yourbusiness.co.za"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor={`${idPrefix}-city`} className={LABEL}>
              Base city / town
            </label>
            <input
              id={`${idPrefix}-city`}
              type="text"
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
              placeholder="Polokwane"
              className={FIELD}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-business-province`} className={LABEL}>
              Base province
            </label>
            <input
              id={`${idPrefix}-business-province`}
              type="text"
              value={form.province}
              onChange={(event) => update("province", event.target.value)}
              placeholder="Limpopo"
              className={FIELD}
            />
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className={LABEL}>Provinces you serve</legend>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Published jobs outside these provinces stay hidden from your board.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PROVINCES.map((province) => {
              const selected = form.serviceProvinces.includes(province);
              return (
                <button
                  key={province}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleProvince(province)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    selected
                      ? "border-[#17633a] bg-[#17633a] text-white"
                      : "border-[#dce2d9] bg-white text-ink-soft hover:bg-page"
                  }`}
                >
                  {province}
                </button>
              );
            })}
          </div>
        </fieldset>

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
            {saving ? "Saving..." : "Save transport details"}
          </button>
        </div>
      </form>
    </div>
  );
}
