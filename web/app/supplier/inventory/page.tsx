"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const SUPPLIER_USER_ID = "ae53df0e-9536-4fb1-a195-5c8c1c75ee74";

type InventoryItem = {
  productId: string;
  name: string;
  sku: string;
  price: number | string;
  unit: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  category: {
    id: string;
    name: string;
    slug: string;
  };
  inventoryId: string | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockLevel: number;
  isLowStock: boolean;
};

type DraftValues = {
  quantity: string;
  lowStockLevel: string;
};

function money(value: number | string) {
  return `R${Number(value).toFixed(2)}`;
}

const STATUS_STYLES: Record<InventoryItem["status"], string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  INACTIVE: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_LABELS: Record<InventoryItem["status"], string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  INACTIVE: "Inactive",
};

export default function SupplierInventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [loading, setLoading] = useState(true);
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "LOW_STOCK">("ALL");

  const loadInventory = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/supplier/inventory?userId=${SUPPLIER_USER_ID}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message ?? "Unable to load supplier inventory");
      }

      const data = (await response.json()) as InventoryItem[];

      setInventory(data);

      const nextDrafts: Record<string, DraftValues> = {};

      for (const item of data) {
        nextDrafts[item.productId] = {
          quantity: String(item.quantity),
          lowStockLevel: String(item.lowStockLevel),
        };
      }

      setDrafts(nextDrafts);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load supplier inventory",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const fetchInventory = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/supplier/inventory?userId=${SUPPLIER_USER_ID}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(
            data?.message ?? "Unable to load supplier inventory",
          );
        }

        const data = (await response.json()) as InventoryItem[];

        if (!cancelled) {
          setInventory(data);

          const nextDrafts: Record<string, DraftValues> = {};

          for (const item of data) {
            nextDrafts[item.productId] = {
              quantity: String(item.quantity),
              lowStockLevel: String(item.lowStockLevel),
            };
          }

          setDrafts(nextDrafts);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load supplier inventory",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchInventory();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredInventory = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return inventory.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.name.toLowerCase().includes(normalizedSearch) ||
        item.sku.toLowerCase().includes(normalizedSearch) ||
        item.category.name.toLowerCase().includes(normalizedSearch);

      const matchesFilter =
        filter === "ALL" || item.isLowStock;

      return matchesSearch && matchesFilter;
    });
  }, [filter, inventory, search]);

  const metrics = useMemo(
    () => ({
      products: inventory.length,
      totalQuantity: inventory.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      reservedQuantity: inventory.reduce(
        (sum, item) => sum + item.reservedQuantity,
        0,
      ),
      availableQuantity: inventory.reduce(
        (sum, item) => sum + item.availableQuantity,
        0,
      ),
      lowStock: inventory.filter((item) => item.isLowStock).length,
    }),
    [inventory],
  );

  const updateDraft = (
    productId: string,
    field: keyof DraftValues,
    value: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [productId]: {
        ...current[productId],
        [field]: value,
      },
    }));

    setSuccess("");
    setError("");
  };

  const saveInventory = async (item: InventoryItem) => {
    const draft = drafts[item.productId];

    if (!draft) {
      return;
    }

    const quantity = Number(draft.quantity);
    const lowStockLevel = Number(draft.lowStockLevel);

    if (!Number.isInteger(quantity) || quantity < 0) {
      setError(`${item.name}: quantity must be a whole number of 0 or more.`);
      setSuccess("");
      return;
    }

    if (!Number.isInteger(lowStockLevel) || lowStockLevel < 0) {
      setError(
        `${item.name}: low-stock level must be a whole number of 0 or more.`,
      );
      setSuccess("");
      return;
    }

    if (quantity < item.reservedQuantity) {
      setError(
        `${item.name}: quantity cannot be below the ${item.reservedQuantity} units already reserved.`,
      );
      setSuccess("");
      return;
    }

    setSavingProductId(item.productId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/supplier/inventory/${item.productId}?userId=${SUPPLIER_USER_ID}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            quantity,
            lowStockLevel,
          }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.message ?? `Unable to update ${item.name} inventory`,
        );
      }

      setInventory((current) =>
        current.map((currentItem) =>
          currentItem.productId === item.productId
            ? {
                ...currentItem,
                quantity: data.quantity,
                reservedQuantity: data.reservedQuantity,
                availableQuantity: data.availableQuantity,
                lowStockLevel: data.lowStockLevel,
                isLowStock: data.isLowStock,
              }
            : currentItem,
        ),
      );

      setDrafts((current) => ({
        ...current,
        [item.productId]: {
          quantity: String(data.quantity),
          lowStockLevel: String(data.lowStockLevel),
        },
      }));

      setSuccess(`${item.name} inventory updated successfully.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Unable to update ${item.name} inventory`,
      );
    } finally {
      setSavingProductId(null);
    }
  };

  const refresh = async () => {
    setSuccess("");
    await loadInventory();
  };

  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              BonAgri
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Supplier Inventory
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage stock levels, reserved quantities and replenishment
              thresholds.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/supplier"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Orders
            </Link>

            <Link
              href="/"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Marketplace
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Products" value={metrics.products} />
          <SummaryCard label="Total stock" value={metrics.totalQuantity} />
          <SummaryCard label="Reserved" value={metrics.reservedQuantity} />
          <SummaryCard label="Available" value={metrics.availableQuantity} />
          <SummaryCard
            label="Low stock"
            value={metrics.lowStock}
            alert={metrics.lowStock > 0}
          />
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Inventory catalogue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Update available stock and define when BonAgri should flag a
                product for replenishment.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-3 md:flex-row">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product, SKU or category..."
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilter("ALL")}
                className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                  filter === "ALL"
                    ? "border-emerald-700 bg-emerald-700 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                All products
              </button>

              <button
                type="button"
                onClick={() => setFilter("LOW_STOCK")}
                className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                  filter === "LOW_STOCK"
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Low stock
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">
              Loading supplier inventory...
            </div>
          ) : filteredInventory.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-medium text-slate-700">
                {inventory.length === 0
                  ? "No inventory records found."
                  : "No products match this filter."}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Try another search or inventory filter.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {filteredInventory.map((item) => {
                const draft = drafts[item.productId];
                const saving = savingProductId === item.productId;

                return (
                  <article
                    key={item.productId}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{item.name}</h3>

                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[item.status]}`}
                          >
                            {STATUS_LABELS[item.status]}
                          </span>

                          {item.isLowStock && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                              Low stock
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>SKU {item.sku}</span>
                          <span>{item.category.name}</span>
                          <span>
                            {money(item.price)} / {item.unit}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-right">
                        <Metric
                          label="Stock"
                          value={`${item.quantity} ${item.unit}`}
                        />
                        <Metric
                          label="Reserved"
                          value={`${item.reservedQuantity} ${item.unit}`}
                        />
                        <Metric
                          label="Available"
                          value={`${item.availableQuantity} ${item.unit}`}
                        />
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Total quantity ({item.unit})
                        </span>
                        <input
                          type="number"
                          min={item.reservedQuantity}
                          step="1"
                          value={draft?.quantity ?? ""}
                          onChange={(event) =>
                            updateDraft(
                              item.productId,
                              "quantity",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                        />
                        <span className="mt-1 block text-xs text-slate-400">
                          Cannot be below {item.reservedQuantity} reserved.
                        </span>
                      </label>

                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Low-stock threshold
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft?.lowStockLevel ?? ""}
                          onChange={(event) =>
                            updateDraft(
                              item.productId,
                              "lowStockLevel",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                        />
                        <span className="mt-1 block text-xs text-slate-400">
                          Flags the product when available stock reaches this
                          level.
                        </span>
                      </label>

                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void saveInventory(item)}
                        className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        alert ? "border-amber-200" : "border-slate-200"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold tracking-tight ${
          alert ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
