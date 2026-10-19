"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type TransporterProfile = {
  id: string;
  businessName: string;
  vehicleType: string | null;
  city: string | null;
  province: string | null;
  serviceProvinces: string[];
  verified: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

export default function AdminTransportersPage() {
  const [profiles, setProfiles] = useState<TransporterProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifiedFilter, setVerifiedFilter] = useState<
    "" | "true" | "false"
  >("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (verifiedFilter) params.set("verified", verifiedFilter);

        const response = await fetch(
          `${API_BASE_URL}/api/admin/transporters?${params.toString()}`,
          { cache: "no-store", headers: authHeaders() },
        );

        if (!response.ok) {
          throw new Error("Unable to load transporter profiles");
        }

        const data = (await response.json()) as TransporterProfile[];

        if (!cancelled) {
          setProfiles(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load transporters",
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
  }, [verifiedFilter]);

  async function toggleVerified(profile: TransporterProfile) {
    const next = !profile.verified;

    const action = next
      ? `Verify ${profile.businessName}? They will immediately see and claim published delivery jobs.`
      : `Remove verification from ${profile.businessName}? They will stop seeing new jobs on the claim board.`;

    if (!window.confirm(action)) return;

    setBusyId(profile.id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/transporters/${profile.id}`,
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
        err instanceof Error ? err.message : "Unable to update transporter",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transporters</h1>
          <p className="mt-1 text-sm text-slate-500">
            Only verified transporters see and claim published delivery jobs.
            Promote accounts from the Users screen.
          </p>
        </div>

        <select
          value={verifiedFilter}
          onChange={(event) =>
            setVerifiedFilter(event.target.value as "" | "true" | "false")
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        >
          <option value="">All profiles</option>
          <option value="true">Verified only</option>
          <option value="false">Unverified only</option>
        </select>
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
        <p className="text-sm text-slate-500">Loading transporters...</p>
      ) : profiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No transporter profiles yet. Promote a buyer to transporter from the
          Users screen to get one started.
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
                    {profile.user.firstName} · {profile.user.email}
                    {profile.vehicleType ? ` · ${profile.vehicleType}` : ""}
                    {profile.city ? ` · ${profile.city}` : ""}
                  </div>

                  <div className="mt-1 text-xs text-slate-600">
                    Serves:{" "}
                    {profile.serviceProvinces.length > 0
                      ? profile.serviceProvinces.join(", ")
                      : "no provinces set"}
                  </div>
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
                      : "Verify transporter"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
