"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PageHeading from "../../../components/supplier/page-heading";
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
    <>
      <PageHeading
        title="My listings"
        description="Create and manage the products you offer on the marketplace."
        fallback="/supplier"
        actions={
          <Link
            href="/supplier/products/new"
            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Add product
          </Link>
        }
      />

        <div className="mt-5">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => {
                const available = product.inventory
                  ? Math.max(
                      product.inventory.quantity -
                        product.inventory.reservedQuantity,
                      0,
                    )
                  : 0;

                return (
                  <article
                    key={product.id}
                    className="flex flex-col justify-between gap-4 rounded-3xl border border-line bg-surface p-4 sm:p-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="min-w-0 break-words font-black tracking-tight text-ink">
                          {product.name}
                        </h3>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[product.status]}`}
                        >
                          {STATUS_LABELS[product.status]}
                        </span>
                      </div>

                      <p className="mt-1 break-words text-xs text-ink-muted">
                        SKU {product.sku} • {product.category.name}
                      </p>

                      <p className="mt-3 text-sm font-black text-ink">
                        R {Number(product.price).toFixed(2)} / {product.unit}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {available} {product.unit} available
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/supplier/products/${product.id}`}
                        className="rounded-xl border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-page"
                      >
                        Edit
                      </Link>

                      <button
                        type="button"
                        disabled={updatingId === product.id}
                        onClick={() => void toggleStatus(product)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
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
                  </article>
                );
              })}
            </div>
          )}
        </div>
    </>
  );
}
