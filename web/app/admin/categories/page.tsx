"use client";

import { FormEvent, useEffect, useState } from "react";
import ImageUpload from "../../../components/media/image-upload";
import { authHeaders } from "../../../lib/auth";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl?: string | null;
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
  const [imageUrl, setImageUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
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
          imageUrl: imageUrl.trim() || undefined,
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
      setImageUrl("");
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
            imageUrl: editImageUrl.trim() ? editImageUrl.trim() : null,
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
      setEditImageUrl("");
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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
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
              placeholder="Fresh regional produce..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Category Image (Rounded Disc)
          </span>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="shrink-0">
              <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-white shadow-sm">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt="Category preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    No image
                  </span>
                )}
              </span>
            </div>
            <div className="flex-1 space-y-2">
              <ImageUpload
                kind="category"
                value={imageUrl}
                onChange={setImageUrl}
              />
              <input
                type="url"
                placeholder="…or paste image URL directly"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-100"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            The URL slug is generated automatically from the name.
          </p>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create Category"}
          </button>
        </div>
      </form>

      {loading ? (
        <AdminRowsSkeleton rows={4} label="Loading categories..." rowHeight="h-16" />
      ) : (
        <div className="space-y-3">
          {categories.map((category) => (
            <div
              key={category.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              {editingId === category.id ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Name
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Description
                      </label>
                      <input
                        type="text"
                        maxLength={300}
                        value={editDescription}
                        onChange={(event) =>
                          setEditDescription(event.target.value)
                        }
                        placeholder="Description"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <span className="mb-2 block text-xs font-semibold text-slate-600">
                      Category Image
                    </span>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="shrink-0">
                        <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-white shadow-sm">
                          {editImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={editImageUrl}
                              alt="Edit preview"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] font-bold uppercase text-slate-400">
                              None
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex-1 space-y-2">
                        <ImageUpload
                          kind="category"
                          value={editImageUrl}
                          onChange={setEditImageUrl}
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            placeholder="…or paste image URL"
                            value={editImageUrl}
                            onChange={(e) => setEditImageUrl(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-100"
                          />
                          {editImageUrl ? (
                            <button
                              type="button"
                              onClick={() => setEditImageUrl("")}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

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
                      onClick={() => {
                        setEditingId(null);
                        setEditImageUrl("");
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-sm">
                      {category.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={category.imageUrl}
                          alt={category.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold uppercase text-slate-400">
                          {category.name.slice(0, 2)}
                        </span>
                      )}
                    </span>
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
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                      setEditDescription(category.description ?? "");
                      setEditImageUrl(category.imageUrl ?? "");
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
