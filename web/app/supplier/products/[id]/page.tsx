"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../../../components/auth/auth-guard";
import ImageUpload from "../../../../components/media/image-upload";
import { authHeaders } from "../../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const UNIT_OPTIONS = ["kg", "bag", "box", "dozen", "litre", "ton", "each"];

type Category = {
  id: string;
  name: string;
};

type SupplierProduct = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  price: string;
  unit: string;
  imageUrl: string | null;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  category: { id: string; name: string };
  inventory: { quantity: number; reservedQuantity: number } | null;
};

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const productId = params.id;

  const [categories, setCategories] = useState<Category[]>([]);
  const [product, setProduct] = useState<SupplierProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("kg");
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "ACTIVE" | "INACTIVE">("DRAFT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [categoriesResponse, productsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/categories`, { cache: "no-store" }),
          fetch(`${API_BASE_URL}/api/supplier/products`, {
            cache: "no-store",
            headers: authHeaders(),
          }),
        ]);

        if (!categoriesResponse.ok || !productsResponse.ok) {
          throw new Error("Unable to load the listing");
        }

        const categoryData = (await categoriesResponse.json()) as Category[];
        const productData =
          (await productsResponse.json()) as SupplierProduct[];
        const found = productData.find((item) => item.id === productId) ?? null;

        if (!cancelled) {
          setCategories(categoryData);
          setProduct(found);

          if (found) {
            setName(found.name);
            setCategoryId(found.category.id);
            setDescription(found.description ?? "");
            setPrice(String(Number(found.price)));
            setUnit(found.unit);
            setImageUrl(found.imageUrl ?? "");
            setStatus(found.status);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load the listing",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function save() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/products/${productId}`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          categoryId,
          description: description.trim() === "" ? undefined : description,
          price: Number(price),
          unit,
          // CP16b: empty field now means "clear the image" (null destroys the
          // managed Cloudinary asset server-side); a pasted URL replaces it.
          imageUrl: imageUrl.trim() === "" ? null : imageUrl.trim(),
          status,
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
            : "Unable to save the listing",
        );
      }

      router.push("/supplier/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the listing");
      setSaving(false);
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
                Edit listing
              </h1>
              {product ? (
                <p className="mt-1 text-sm text-slate-500">
                  {product.sku} · {product.slug}
                </p>
              ) : null}
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
          {loading ? (
            <p className="text-sm text-slate-500">Loading the listing...</p>
          ) : !product ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <h2 className="text-lg font-semibold text-slate-900">
                Listing not found
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                This product does not belong to your account.
              </p>
              <Link
                href="/supplier/products"
                className="mt-6 inline-block rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Back to my listings
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
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
                  />
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="unit"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Unit
                    </label>
                    <select
                      id="unit"
                      name="unit"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    >
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Photo{" "}
                    <span className="font-normal text-slate-400">
                      (optional)
                    </span>
                  </span>
                  <ImageUpload
                    kind="product"
                    value={imageUrl}
                    onChange={setImageUrl}
                  />
                </div>

                <div>
                  <label
                    htmlFor="imageUrl"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    …or paste an image URL
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

                <div>
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Status
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["DRAFT", "Draft (hidden)"],
                        ["ACTIVE", "Active (published)"],
                        ["INACTIVE", "Inactive (hidden)"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStatus(value)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                          status === value
                            ? "bg-emerald-700 text-white"
                            : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  In stock:{" "}
                  <span className="font-semibold text-slate-900">
                    {product.inventory?.quantity ?? 0} {product.unit}
                  </span>{" "}
                  ({product.inventory?.reservedQuantity ?? 0} reserved) — adjust
                  stock on the{" "}
                  <Link
                    href="/supplier/inventory"
                    className="font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    inventory page
                  </Link>
                  .
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
