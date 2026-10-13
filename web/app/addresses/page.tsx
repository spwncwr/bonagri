"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { authHeaders } from "../../lib/auth";

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
};

type AddressForm = typeof emptyForm;

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
    });
    setFormError("");
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setFormError("");
  }

  function setField(field: keyof AddressForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#17633a]">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Delivery addresses
              </h1>
              <p className="mt-1 text-sm text-[#69756c]">
                Manage where your orders get delivered.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Add address
              </button>

              <Link
                href="/#orders"
                className="rounded-xl border border-[#dce2d9] bg-white px-4 py-2 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
              >
                ← My Orders
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-6 py-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {showForm ? (
            <form
              onSubmit={(event) => void submitForm(event)}
              className="mb-8 rounded-2xl border border-[#dce2d9] bg-white p-6 shadow-sm"
            >
              <h2 className="text-base font-bold text-[#17251b]">
                {editingId ? "Edit address" : "New address"}
              </h2>

              {formError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {formError}
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="label"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                    placeholder="Home"
                  />
                </div>

                <div>
                  <label
                    htmlFor="recipientName"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="city"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="addressLine1"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="addressLine2"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="province"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="postalCode"
                    className="mb-1.5 block text-sm font-medium text-[#344238]"
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
                    className="w-full rounded-lg border border-[#dce2d9] px-3 py-2.5 outline-none transition focus:border-[#17633a] focus:ring-2 focus:ring-[#e5f1e4]"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#17633a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-lg border border-[#dce2d9] px-5 py-2.5 text-sm font-semibold text-[#344238] transition hover:bg-[#f7f8f4]"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#69756c]">Loading addresses...</p>
          ) : addresses.length === 0 && !showForm ? (
            <div className="rounded-2xl border border-dashed border-[#dce2d9] bg-white p-12 text-center">
              <h2 className="text-lg font-semibold">No addresses yet</h2>
              <p className="mt-2 text-sm text-[#69756c]">
                Add a delivery address to place your first order.
              </p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-6 rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Add address
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {addresses.map((address) => (
                <article
                  key={address.id}
                  className="rounded-2xl border border-[#dce2d9] bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-[#17251b]">
                          {address.label}
                        </span>

                        {address.isDefault ? (
                          <span className="rounded-full bg-[#e5f1e4] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#17633a]">
                            Default
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-sm text-[#344238]">
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

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(address)}
                        className="rounded-lg border border-[#dce2d9] px-3 py-1.5 text-xs font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
                      >
                        Edit
                      </button>

                      {!address.isDefault ? (
                        <button
                          type="button"
                          disabled={updatingId === address.id}
                          onClick={() => void makeDefault(address)}
                          className="rounded-lg border border-[#dce2d9] px-3 py-1.5 text-xs font-medium text-[#344238] transition hover:bg-[#f7f8f4] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Make default
                        </button>
                      ) : null}

                      <button
                        type="button"
                        disabled={updatingId === address.id}
                        onClick={() => void removeAddress(address)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
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
