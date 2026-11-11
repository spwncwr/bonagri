"use client";

// Vendor settings, inside the desk shell so the bottom bar and the back
// button stay put like every other /supplier screen. Two halves: the shared
// account card (name, contact, display picture) and the storefront details
// buyers see, including the logo.
import { useEffect, useState } from "react";
import ImageUpload from "../../../components/media/image-upload";
import AccountSettings from "../../../components/settings/account-settings";
import PageHeading from "../../../components/supplier/page-heading";
import {
  authHeaders,
  fetchCurrentUser,
  type AuthUser,
} from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const FIELD =
  "mt-1 w-full rounded-xl border border-[#dce2d9] bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#17633a] focus:outline-none";
const LABEL =
  "block text-xs font-bold uppercase tracking-wide text-[#7b867d]";
const READONLY_FIELD = `${FIELD} cursor-not-allowed bg-page text-ink-muted`;

type BusinessForm = {
  logoUrl: string;
  businessName: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
};

function emptyForm(): BusinessForm {
  return {
    logoUrl: "",
    businessName: "",
    description: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    province: "",
  };
}

function readError(data: unknown): string {
  const payload = data as { message?: string | string[] } | null;
  const message = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : payload?.message;
  return message || "Could not save your details — try again.";
}

export default function SupplierSettingsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [registrationNo, setRegistrationNo] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((next) => {
      if (cancelled) return;

      setUser(next);
      const supplier = next?.supplierProfile ?? null;
      setForm(
        supplier
          ? {
              logoUrl: supplier.logoUrl ?? "",
              businessName: supplier.businessName,
              description: supplier.description ?? "",
              phone: supplier.phone ?? "",
              email: supplier.email ?? "",
              address: supplier.address ?? "",
              city: supplier.city ?? "",
              province: supplier.province ?? "",
            }
          : emptyForm(),
      );
      setRegistrationNo(supplier?.registrationNo ?? null);
      setVerified(supplier?.verified ?? false);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function update(field: keyof BusinessForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveBusiness(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/supplier/profile`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          logoUrl: form.logoUrl.trim() || null,
          businessName: form.businessName.trim(),
          description: form.description.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          province: form.province.trim() || null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readError(data));
      }

      const saved = data as BusinessForm & {
        registrationNo: string | null;
        verified: boolean;
      };

      setForm({
        logoUrl: saved.logoUrl ?? "",
        businessName: saved.businessName ?? "",
        description: saved.description ?? "",
        phone: saved.phone ?? "",
        email: saved.email ?? "",
        address: saved.address ?? "",
        city: saved.city ?? "",
        province: saved.province ?? "",
      });
      setRegistrationNo(saved.registrationNo ?? null);
      setVerified(saved.verified ?? false);
      setNotice("Storefront details saved.");

      if (user) {
        setUser({
          ...user,
          supplierProfile: {
            businessName: saved.businessName ?? "",
            description: saved.description ?? null,
            registrationNo: saved.registrationNo ?? null,
            phone: saved.phone ?? null,
            email: saved.email ?? null,
            address: saved.address ?? null,
            city: saved.city ?? null,
            province: saved.province ?? null,
            logoUrl: saved.logoUrl ?? null,
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
      <>
        <PageHeading title="Settings" fallback="/supplier" />
        <p className="mt-5 text-sm text-ink-muted">Loading your settings...</p>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <PageHeading title="Settings" fallback="/supplier" />
        <p className="mt-5 text-sm text-ink-muted">
          Your session ended — sign in again.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="Settings"
        description="Your account and the storefront details buyers see."
        fallback="/supplier"
      />

      <div className="mt-5 grid gap-5">
        <AccountSettings
          user={user}
          onSaved={(next) => setUser(next)}
        />

        <form
          onSubmit={(event) => void saveBusiness(event)}
          aria-label="Storefront details"
          className="rounded-3xl border border-line bg-surface p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black tracking-tight text-ink">
              Storefront
            </h2>
            {verified ? (
              <span className="rounded-full bg-[#e8f1e6] px-2.5 py-1 text-[10px] font-bold text-[#17633a]">
                BUSINESS VERIFIED
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                PENDING REVIEW
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            What shoppers read on your listings and shop page.
          </p>

          <div className="mt-5">
            <span className={LABEL}>Store logo</span>
            <div className="mt-2">
              <ImageUpload
                kind="supplier_logo"
                value={form.logoUrl}
                onChange={(url) => update("logoUrl", url)}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="business-name" className={LABEL}>
                Business name
              </label>
              <input
                id="business-name"
                type="text"
                required
                value={form.businessName}
                onChange={(event) => update("businessName", event.target.value)}
                className={FIELD}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="business-description" className={LABEL}>
                About the business
              </label>
              <textarea
                id="business-description"
                rows={3}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="What you grow or supply, and where from."
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="business-phone" className={LABEL}>
                Business phone
              </label>
              <input
                id="business-phone"
                type="tel"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="015 000 0000"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="business-email" className={LABEL}>
                Business email
              </label>
              <input
                id="business-email"
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="sales@yourbusiness.co.za"
                className={FIELD}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="business-address" className={LABEL}>
                Street address
              </label>
              <input
                id="business-address"
                type="text"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="business-city" className={LABEL}>
                City / town
              </label>
              <input
                id="business-city"
                type="text"
                value={form.city}
                onChange={(event) => update("city", event.target.value)}
                placeholder="Polokwane"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="business-province" className={LABEL}>
                Province
              </label>
              <input
                id="business-province"
                type="text"
                value={form.province}
                onChange={(event) => update("province", event.target.value)}
                placeholder="Limpopo"
                className={FIELD}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="business-registration" className={LABEL}>
                Registration number
              </label>
              <input
                id="business-registration"
                type="text"
                value={registrationNo ?? ""}
                readOnly
                placeholder="Not on file"
                aria-describedby="business-registration-hint"
                className={READONLY_FIELD}
              />
              <p
                id="business-registration-hint"
                className="mt-1.5 text-xs leading-5 text-ink-muted"
                data-registration-readonly="true"
              >
                Set when your business was registered with BonAgri — contact
                support to correct it.
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
              {saving ? "Saving..." : "Save storefront"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
