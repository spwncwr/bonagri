"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../../../components/auth/auth-guard";
import { authHeaders } from "../../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const UNIT_PRESETS: Record<"Produce" | "Tools", string[]> = {
  // Default produce units (mass/volume based).
  Produce: ["kg", "bag", "box", "dozen", "litre", "ton"],
  // Tool/equipment listings are counted per item (CP4).
  Tools: ["each", "unit", "bag", "box"],
};

type Category = {
  id: string;
  name: string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function generateSku(name: string) {
  const letters = name.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
  const suffix = Math.floor(1000 + Math.random() * 9000);

  return `BON-${letters || "ITM"}-${suffix}`;
}

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("kg");
  const [imageUrl, setImageUrl] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [unitPreset, setUnitPreset] = useState<"Produce" | "Tools">("Produce");

  function selectUnitPreset(preset: "Produce" | "Tools") {
    setUnitPreset(preset);

    if (!UNIT_PRESETS[preset].includes(unit)) {
      setUnit(preset === "Tools" ? "each" : "kg");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
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
      } catch {
        if (!cancelled) {
          setError("Unable to load product categories — reload the page.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitListing(status: "DRAFT" | "ACTIVE") {
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/products`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categoryId,
          name,
          slug: `${slugify(name)}-${Math.floor(1000 + Math.random() * 9000)}`,
          sku: generateSku(name),
          description: description.trim() === "" ? undefined : description,
          price: Number(price),
          unit,
          imageUrl: imageUrl.trim() === "" ? undefined : imageUrl.trim(),
          status,
          quantity: Number(quantity || "0"),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;

        throw new Error(
          data?.message
            ? Array.isArray(data.message)
              ? data.message.join(", ")
              : data.message
            : "Unable to create the listing",
        );
      }

      router.push("/supplier/products");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create the listing",
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthGuard allowedRoles={["SUPPLIER", "AGRO_DEALER"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Add product
              </h1>
            </div>

            <Link
              href="/supplier/products"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              ← My listings
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-3xl px-6 py-8">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitListing("ACTIVE");
            }}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            {error ? (
              <div
                role="alert"
                className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            ) : null}

            <div className="space-y-5">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Product name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Fresh Tomatoes"
                />
              </div>

              <div>
                <label
                  htmlFor="categoryId"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Category
                </label>
                <select
                  id="categoryId"
                  name="categoryId"
                  required
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Select a category...</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Grade 1 tomatoes from Tzaneen, Limpopo."
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="price"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Price (R)
                  </label>
                  <input
                    id="price"
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    placeholder="18.00"
                  />
                </div>

                <div>
                  <label
                    htmlFor="unit"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Unit
                  </label>
                  <div className="mb-2 flex gap-2">
                    {(["Produce", "Tools"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => selectUnitPreset(preset)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          unitPreset === preset
                            ? "bg-emerald-700 text-white"
                            : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {preset === "Produce"
                          ? "Produce units"
                          : "Tool units"}
                      </button>
                    ))}
                  </div>
                  <select
                    id="unit"
                    name="unit"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  >
                    {UNIT_PRESETS[unitPreset].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="quantity"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    Initial stock
                  </label>
                  <input
                    id="quantity"
                    name="quantity"
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="imageUrl"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Image URL{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="imageUrl"
                  name="imageUrl"
                  type="url"
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  placeholder="https://..."
                />
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row">
                <button
                  type="submit"
                  disabled={submitting || !categoryId}
                  className="flex-1 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Save & publish"}
                </button>

                <button
                  type="button"
                  disabled={submitting || !categoryId}
                  onClick={() => void submitListing("DRAFT")}
                  className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save as draft
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Published listings appear on the marketplace immediately. Drafts
                stay private until you activate them.
              </p>
            </div>
          </form>
        </div>
      </main>
    </AuthGuard>
  );
}
