"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type AdminUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  emailVerifiedAt: string | null;
  createdAt: string;
  supplierProfile: {
    id: string;
    businessName: string;
    verified: boolean;
  } | null;
  _count: { orders: number };
};

const ROLE_STYLES: Record<AdminUser["role"], string> = {
  BUYER: "bg-slate-100 text-slate-700",
  SUPPLIER: "bg-emerald-100 text-emerald-800",
  AGRO_DEALER: "bg-teal-100 text-teal-800",
  ADMIN: "bg-purple-100 text-purple-800",
};

function apiError(data: { message?: string | string[] } | null, fallback: string) {
  if (!data?.message) return fallback;
  return Array.isArray(data.message)
    ? data.message.join(", ")
    : data.message;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [promoteCity, setPromoteCity] = useState("");
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (roleFilter) params.set("role", roleFilter);

        const response = await fetch(
          `${API_BASE_URL}/api/admin/users?${params.toString()}`,
          { cache: "no-store", headers: authHeaders() },
        );

        if (!response.ok) {
          throw new Error("Unable to load users");
        }

        const data = (await response.json()) as AdminUser[];

        if (!cancelled) {
          setUsers(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load users");
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
  }, [search, roleFilter]);

  async function reload() {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (roleFilter) params.set("role", roleFilter);

    const response = await fetch(
      `${API_BASE_URL}/api/admin/users?${params.toString()}`,
      { cache: "no-store", headers: authHeaders() },
    );

    if (response.ok) {
      setUsers((await response.json()) as AdminUser[]);
    }
  }

  async function setStatus(user: AdminUser, status: "ACTIVE" | "SUSPENDED") {
    const action =
      status === "SUSPENDED"
        ? `Suspend ${user.firstName} ${user.lastName}? They will be logged out and unable to sign in.`
        : `Reactivate ${user.firstName} ${user.lastName}?`;

    if (!window.confirm(action)) return;

    setBusyId(user.id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/users/${user.id}/status`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        throw new Error(apiError(data, "Unable to update the user"));
      }

      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update");
    } finally {
      setBusyId(null);
    }
  }

  async function promote(user: AdminUser) {
    if (!businessName.trim()) return;

    setPromoting(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/users/${user.id}/promote-supplier`,
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            businessName: businessName.trim(),
            city: promoteCity.trim() || undefined,
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        throw new Error(apiError(data, "Unable to promote the user"));
      }

      setPromotingId(null);
      setBusinessName("");
      setPromoteCity("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to promote");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Suspend, reactivate and promote accounts across the platform.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or email..."
            className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />

          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="">All roles</option>
            <option value="BUYER">Buyers</option>
            <option value="SUPPLIER">Suppliers</option>
            <option value="AGRO_DEALER">Agro dealers</option>
            <option value="ADMIN">Admins</option>
          </select>
        </div>
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
        <p className="text-sm text-slate-500">Loading users...</p>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-600">
          No users match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {user.firstName} {user.lastName}
                    </span>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_STYLES[user.role]}`}
                    >
                      {user.role.replaceAll("_", " ")}
                    </span>

                    {user.status === "SUSPENDED" ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                        Suspended
                      </span>
                    ) : null}

                    {user.supplierProfile?.verified ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                        Verified
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1 truncate text-xs text-slate-500">
                    {user.email} · {user._count.orders} orders · joined{" "}
                    {new Date(user.createdAt).toLocaleDateString("en-ZA", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    {user.emailVerifiedAt
                      ? ""
                      : " · email unverified"}
                  </div>

                  {user.supplierProfile ? (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {user.supplierProfile.businessName}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {user.role === "BUYER" && !user.supplierProfile ? (
                    promotingId === user.id ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          setPromotingId(user.id);
                          setBusinessName(
                            `${user.firstName} ${user.lastName} Agri`,
                          );
                          setPromoteCity("");
                        }}
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Promote to supplier
                      </button>
                    )
                  ) : null}

                  {user.status === "ACTIVE" && user.role !== "ADMIN" ? (
                    <button
                      type="button"
                      disabled={busyId === user.id}
                      onClick={() => void setStatus(user, "SUSPENDED")}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === user.id ? "Saving..." : "Suspend"}
                    </button>
                  ) : null}

                  {user.status === "SUSPENDED" ? (
                    <button
                      type="button"
                      disabled={busyId === user.id}
                      onClick={() => void setStatus(user, "ACTIVE")}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === user.id ? "Saving..." : "Reactivate"}
                    </button>
                  ) : null}
                </div>
              </div>

              {promotingId === user.id ? (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <label
                      htmlFor={`business-${user.id}`}
                      className="mb-1 block text-xs font-medium text-slate-600"
                    >
                      Business name
                    </label>
                    <input
                      id={`business-${user.id}`}
                      type="text"
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                      className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`city-${user.id}`}
                      className="mb-1 block text-xs font-medium text-slate-600"
                    >
                      City{" "}
                      <span className="font-normal text-slate-400">
                        (optional)
                      </span>
                    </label>
                    <input
                      id={`city-${user.id}`}
                      type="text"
                      value={promoteCity}
                      onChange={(event) => setPromoteCity(event.target.value)}
                      className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={promoting || !businessName.trim()}
                    onClick={() => void promote(user)}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promoting ? "Promoting..." : "Confirm promotion"}
                  </button>

                  <button
                    type="button"
                    disabled={promoting}
                    onClick={() => setPromotingId(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
