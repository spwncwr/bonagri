"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AuthGuard from "../../../components/auth/auth-guard";
import { authHeaders } from "../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

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

const STATUS_STYLES: Record<SupplierProduct["status"], string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-amber-100 text-amber-800",
  INACTIVE: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<SupplierProduct["status"], string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  INACTIVE: "Inactive",
};

export default function SupplierProductsPage() {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/supplier/products`, {
        cache: "no-store",
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error("Unable to load your listings");
      }

      setProducts((await response.json()) as SupplierProduct[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load listings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/supplier/products`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (!response.ok) {
          throw new Error("Unable to load your listings");
        }

        const data = (await response.json()) as SupplierProduct[];

        if (!cancelled) {
          setProducts(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load listings",
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

  const toggleStatus = async (product: SupplierProduct) => {
    const nextStatus =
      product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    setUpdatingId(product.id);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/products/${product.id}`, {
        method: "PATCH",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
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
            : "Unable to update listing",
        );
      }

      await loadProducts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update listing",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <AuthGuard allowedRoles={["SUPPLIER", "AGRO_DEALER"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                My listings
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Create and manage the products you offer on the marketplace.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/supplier/products/new"
                className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Add product
              </Link>

              <Link
                href="/supplier"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Order queue
              </Link>

              <Link
                href="/supplier/inventory"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Inventory
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-6 py-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-500">Loading your listings...</p>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <h2 className="text-lg font-semibold text-slate-900">
                No listings yet
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Add your first product to appear on the BonAgri marketplace.
              </p>
              <Link
                href="/supplier/products/new"
                className="mt-6 inline-block rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                Add product
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Available</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((product) => {
                    const available = product.inventory
                      ? Math.max(
                          product.inventory.quantity -
                            product.inventory.reservedQuantity,
                          0,
                        )
                      : 0;

                    return (
                      <tr key={product.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">
                            {product.name}
                          </p>
                          <p className="text-xs text-slate-500">{product.sku}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {product.category.name}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          R {Number(product.price).toFixed(2)} / {product.unit}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {available} {product.unit}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[product.status]}`}
                          >
                            {STATUS_LABELS[product.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/supplier/products/${product.id}`}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Edit
                            </Link>

                            <button
                              type="button"
                              disabled={updatingId === product.id}
                              onClick={() => void toggleStatus(product)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                product.status === "ACTIVE"
                                  ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  : "bg-emerald-700 text-white hover:bg-emerald-800"
                              }`}
                            >
                              {updatingId === product.id
                                ? "Saving..."
                                : product.status === "ACTIVE"
                                  ? "Deactivate"
                                  : "Activate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
