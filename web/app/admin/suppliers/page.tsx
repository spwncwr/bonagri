"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type SupplierProfile = {
  id: string;
  businessName: string;
  description: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  verified: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
  _count: { products: number };
};

export default function AdminSuppliersPage() {
  const [profiles, setProfiles] = useState<SupplierProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/suppliers`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Unable to load supplier profiles");
        }

        const data = (await response.json()) as SupplierProfile[];

        if (!cancelled) {
          setProfiles(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load suppliers",
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

  async function toggleVerified(profile: SupplierProfile) {
    const next = !profile.verified;

    setBusyId(profile.id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/suppliers/${profile.id}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ verified: next }),
        },
      );

      if (!response.ok) {
        throw new Error("Unable to update the verification state");
      }

      setProfiles((current) =>
        current.map((item) =>
          item.id === profile.id ? { ...item, verified: next } : item,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update supplier",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Verification badges are shown publicly on the marketplace — every
          listing displays its supplier&apos;s verified state.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading suppliers...</p>
      ) : profiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No supplier profiles yet.
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {profile.businessName}
                    </span>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        profile.verified
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.verified ? "Verified" : "Unverified"}
                    </span>

                    {profile.user.status === "SUSPENDED" ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                        Owner suspended
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    {profile.user.email}
                    {profile.city ? ` · ${profile.city}` : ""}
                    {profile.province ? `, ${profile.province}` : ""} ·{" "}
                    {profile._count.products} products
                  </div>

                  {profile.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {profile.description}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={busyId === profile.id}
                  onClick={() => void toggleVerified(profile)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    profile.verified
                      ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
                      : "bg-emerald-700 text-white hover:bg-emerald-800"
                  }`}
                >
                  {busyId === profile.id
                    ? "Saving..."
                    : profile.verified
                      ? "Remove verification"
                      : "Verify supplier"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
