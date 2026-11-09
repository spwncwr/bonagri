"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { BrandLogo } from "../../components/brand/logo";
import LocationPicker, {
  type GeocodedPlace,
} from "../../components/addresses/location-picker";
import { ArrowLeftIcon } from "../../components/mobile/icons";
import { authHeaders } from "../../lib/auth";
import { goBackOr } from "../../lib/navigation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Address = {
  id: string;
  label: string;
  recipientName: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
  lat: number | null;
  lng: number | null;
};

const emptyForm = {
  label: "Home",
  recipientName: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  country: "South Africa",
  lat: null as number | null,
  lng: null as number | null,
};

type AddressForm = typeof emptyForm;

export default function AddressesPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Latest reverse-geocode of the pin in the form — applied to the text
  // fields only when the buyer presses "Fill address from pin" (never
  // silently). Cleared on every pin change so a stale place can't linger.
  const [resolvedPlace, setResolvedPlace] = useState<GeocodedPlace | null>(
    null,
  );

  // True back: return to the screen the buyer came from (checkout, cart or
  // profile). Fresh deep links fall back to the profile hub — see
  // lib/navigation.ts.
  function goBack() {
    goBackOr(router, "/profile");
  }

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/addresses`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Unable to load your addresses");
        }

        const data = (await response.json()) as Address[];

        if (!cancelled) {
          setAddresses(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load addresses",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    const response = await fetch(`${API_BASE_URL}/api/addresses`, {
      cache: "no-store",
      headers: authHeaders(),
    });

    if (response.ok) {
      setAddresses((await response.json()) as Address[]);
    }
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setResolvedPlace(null);
    setFormError("");
    setShowForm(true);
  }

  function startEdit(address: Address) {
    setEditingId(address.id);
    setForm({
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone ?? "",
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? "",
      city: address.city,
      province: address.province ?? "",
      postalCode: address.postalCode ?? "",
      country: address.country,
      lat: address.lat,
      lng: address.lng,
    });
    setResolvedPlace(null);
    setFormError("");
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setResolvedPlace(null);
    setFormError("");
  }

  function setField(field: keyof AddressForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setPin(point: { lat: number; lng: number } | null) {
    setForm((current) => ({ ...current, lat: point?.lat ?? null, lng: point?.lng ?? null }));
  }

  // Explicit, buyer-initiated: copy the geocoded street/city/province/postcode
  // into the manual fields. Recipient, phone and label are never touched.
  function fillFromPin() {
    if (!resolvedPlace) return;

    setForm((current) => ({
      ...current,
      addressLine1: resolvedPlace.addressLine1 || current.addressLine1,
      city: resolvedPlace.city || current.city,
      province: resolvedPlace.province || current.province,
      postalCode: resolvedPlace.postalCode || current.postalCode,
      country: resolvedPlace.country || current.country,
    }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const isEdit = editingId !== null;
      const response = await fetch(
        isEdit
          ? `${API_BASE_URL}/api/addresses/${editingId}`
          : `${API_BASE_URL}/api/addresses`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(form),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to save the address",
        );
      }

      await reload();
      cancelForm();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Unable to save the address",
      );
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(address: Address) {
    setUpdatingId(address.id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/addresses/${address.id}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isDefault: true }),
        },
      );

      if (!response.ok) {
        throw new Error("Unable to set the default address");
      }

      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to set default",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeAddress(address: Address) {
    const confirmed = window.confirm(
      `Delete "${address.label}"? Addresses used by existing orders cannot be removed.`,
    );

    if (!confirmed) return;

    setUpdatingId(address.id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/addresses/${address.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;

        throw new Error(data?.message ?? "Unable to delete the address");
      }

      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete the address",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <AuthGuard requiredRole="BUYER">
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-[#dce2d9] bg-white">
          <div className="mx-auto max-w-2xl px-4 py-4">
            <div className="min-w-0">
              <BrandLogo height={22} />
              <h1 className="mt-2 text-xl font-black tracking-tight text-[#17251b]">
                Delivery addresses
              </h1>
              <p className="mt-1 text-xs leading-5 text-[#7c877e]">
                Manage where your orders get delivered.
              </p>
            </div>

            {/* Actions get their own wrapping row so the title never gets
                squeezed against the buttons on thin phones. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                Back
              </button>

              <button
                type="button"
                onClick={startCreate}
                className="rounded-full bg-[#17633a] px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99]"
              >
                Add address
              </button>

              <Link
                href="/orders"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2d9] bg-white px-4 py-2.5 text-xs font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                My Orders
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {showForm ? (
            <form
              onSubmit={(event) => void submitForm(event)}
              className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm sm:p-5"
            >
              <h2 className="text-sm font-black tracking-tight text-[#17251b]">
                {editingId ? "Edit address" : "New address"}
              </h2>

              {formError ? (
                <div
                  role="alert"
                  className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {formError}
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="label"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Label
                  </label>
                  <input
                    id="label"
                    type="text"
                    required
                    maxLength={50}
                    value={form.label}
                    onChange={(event) => setField("label", event.target.value)}
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                    placeholder="Home"
                  />
                </div>

                <div>
                  <label
                    htmlFor="recipientName"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Recipient name
                  </label>
                  <input
                    id="recipientName"
                    type="text"
                    required
                    maxLength={120}
                    value={form.recipientName}
                    onChange={(event) =>
                      setField("recipientName", event.target.value)
                    }
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Phone{" "}
                    <span className="font-normal text-[#7b867d]">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    maxLength={30}
                    value={form.phone}
                    onChange={(event) => setField("phone", event.target.value)}
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="city"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    City
                  </label>
                  <input
                    id="city"
                    type="text"
                    required
                    maxLength={100}
                    value={form.city}
                    onChange={(event) => setField("city", event.target.value)}
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="addressLine1"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Street address
                  </label>
                  <input
                    id="addressLine1"
                    type="text"
                    required
                    maxLength={200}
                    value={form.addressLine1}
                    onChange={(event) =>
                      setField("addressLine1", event.target.value)
                    }
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="addressLine2"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Suite / complex{" "}
                    <span className="font-normal text-[#7b867d]">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="addressLine2"
                    type="text"
                    maxLength={200}
                    value={form.addressLine2}
                    onChange={(event) =>
                      setField("addressLine2", event.target.value)
                    }
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="province"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Province
                  </label>
                  <input
                    id="province"
                    type="text"
                    maxLength={100}
                    value={form.province}
                    onChange={(event) =>
                      setField("province", event.target.value)
                    }
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="postalCode"
                    className="mb-1.5 block text-xs font-semibold text-[#69756c]"
                  >
                    Postal code
                  </label>
                  <input
                    id="postalCode"
                    type="text"
                    maxLength={20}
                    value={form.postalCode}
                    onChange={(event) =>
                      setField("postalCode", event.target.value)
                    }
                    className="w-full rounded-xl border border-[#dce2d9] bg-white px-3.5 py-3 text-sm text-[#17251b] outline-none transition placeholder:text-[#9aa49b] focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>
              </div>

              {/* Delivery destination pin — optional, saved alongside the
                  manual fields. Checkout works either way; a missing pin is
                  flagged as "needs location confirmation" in the list. */}
              <div className="mt-5 border-t border-[#e9ede7] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-[#17251b]">
                      Delivery location
                    </h3>
                    <p className="mt-0.5 text-xs leading-5 text-[#7c877e]">
                      Drop a pin or use GPS so the courier gets your exact
                      destination. Optional — you can keep typing the address
                      manually.
                    </p>
                  </div>

                  {form.lat != null && form.lng != null ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPin(null);
                        setResolvedPlace(null);
                      }}
                      className="shrink-0 rounded-full border border-[#dce2d9] bg-white px-3 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#f7f8f4]"
                    >
                      Clear pin
                    </button>
                  ) : null}
                </div>

                <LocationPicker
                  className="mt-3"
                  lat={form.lat}
                  lng={form.lng}
                  onChange={(point) => {
                    setPin(point);
                    setResolvedPlace(null);
                  }}
                  onResolved={setResolvedPlace}
                />

                {resolvedPlace ? (
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#dce2d9] bg-[#fbfcf9] px-3.5 py-3">
                    <div className="min-w-0 text-xs leading-5 text-[#344238]">
                      <div className="font-black text-[#17251b]">
                        Location found
                      </div>
                      <div className="line-clamp-2">
                        {resolvedPlace.displayName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={fillFromPin}
                      className="shrink-0 rounded-full border border-[#17633a] bg-white px-3 py-1.5 text-xs font-black text-[#17633a] transition hover:bg-[#eaf2e8]"
                    >
                      Fill address from pin
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#17633a] px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save changes"
                      : "Add address"}
                </button>

                <button
                  type="button"
                  onClick={cancelForm}
                  className="rounded-full border border-[#dce2d9] bg-white px-6 py-3 text-sm font-bold text-[#344238] shadow-sm transition hover:bg-[#f7f8f4] active:scale-[0.99]"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#69756c]">Loading addresses...</p>
          ) : addresses.length === 0 && !showForm ? (
            <div className="rounded-2xl border border-dashed border-[#dce2d9] bg-white p-8 text-center">
              <h2 className="text-base font-black text-[#17251b]">
                No addresses yet
              </h2>
              <p className="mt-2 text-sm text-[#69756c]">
                Add a delivery address to place your first order.
              </p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-5 rounded-full bg-[#17633a] px-6 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[#0f4d2b] active:scale-[0.99]"
              >
                Add address
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {addresses.map((address) => (
                <article
                  key={address.id}
                  className="rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm"
                >
                  {/* Text stacks above the actions on phones (so long
                      addresses never crush the buttons), side by side on
                      wider screens. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-[#17251b]">
                          {address.label}
                        </span>

                        {address.isDefault ? (
                          <span className="rounded-full bg-[#e5f1e4] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                            Default
                          </span>
                        ) : null}

                        {address.lat != null && address.lng != null ? (
                          <span className="rounded-full bg-[#e5f1e4] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                            Location confirmed
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#eee8c9] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#8a6d12]">
                            Needs location confirmation
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-sm leading-6 text-[#344238]">
                        <p className="font-bold">{address.recipientName}</p>
                        <p>{address.addressLine1}</p>
                        {address.addressLine2 ? (
                          <p>{address.addressLine2}</p>
                        ) : null}
                        <p>
                          {address.city}
                          {address.province
                            ? `, ${address.province}`
                            : ""}
                          {address.postalCode ? ` ${address.postalCode}` : ""}
                        </p>
                        <p className="text-[#69756c]">{address.country}</p>
                        {address.phone ? (
                          <p className="text-[#69756c]">{address.phone}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => startEdit(address)}
                        className="rounded-full border border-[#dce2d9] bg-white px-3.5 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#f7f8f4] active:scale-[0.98]"
                      >
                        Edit
                      </button>

                      {!address.isDefault ? (
                        <button
                          type="button"
                          disabled={updatingId === address.id}
                          onClick={() => void makeDefault(address)}
                          className="rounded-full border border-[#dce2d9] bg-white px-3.5 py-1.5 text-xs font-bold text-[#344238] transition hover:bg-[#f7f8f4] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Make default
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={updatingId === address.id}
                        onClick={() => void removeAddress(address)}
                        className="rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
