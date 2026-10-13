"use client";

import { FormEvent, useEffect, useState } from "react";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

function apiError(data: { message?: string | string[] } | null, fallback: string) {
  if (!data?.message) return fallback;
  return Array.isArray(data.message)
    ? data.message.join(", ")
    : data.message;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/categories`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load categories");
        }

        const data = (await response.json()) as Category[];

        if (!cancelled) {
          setCategories(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load categories",
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
    const response = await fetch(`${API_BASE_URL}/api/categories`, {
      cache: "no-store",
    });

    if (response.ok) {
      setCategories((await response.json()) as Category[]);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/categories`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        throw new Error(apiError(data, "Unable to create the category"));
      }

      setName("");
      setDescription("");
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create category",
      );
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(id: string) {
    setSavingId(id);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/admin/categories/${id}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editName.trim(),
            description: editDescription.trim(),
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        throw new Error(apiError(data, "Unable to save the category"));
      }

      setEditingId(null);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save category",
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
        <p className="mt-1 text-sm text-slate-500">
          Categories appear on the public marketplace filter bar immediately
          after saving.
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

      <form
        onSubmit={(event) => void createCategory(event)}
        className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-sm font-bold text-slate-900">New category</h2>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="cat-name"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Name
            </label>
            <input
              id="cat-name"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Poultry & Livestock"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="min-w-52 flex-1">
            <label
              htmlFor="cat-desc"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Description{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="cat-desc"
              type="text"
              maxLength={300}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          The URL slug is generated automatically from the name.
        </p>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading categories...</p>
      ) : (
        <div className="space-y-3">
          {categories.map((category) => (
            <div
              key={category.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              {editingId === category.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    type="text"
                    maxLength={300}
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Description"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={savingId === category.id || !editName.trim()}
                      onClick={() => void saveEdit(category.id)}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingId === category.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={savingId === category.id}
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {category.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        /{category.slug}
                      </span>
                    </div>
                    {category.description ? (
                      <p className="mt-0.5 text-xs text-slate-600">
                        {category.description}
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                      setEditDescription(category.description ?? "");
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
