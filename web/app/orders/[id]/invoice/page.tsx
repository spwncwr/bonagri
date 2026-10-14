"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AuthGuard from "../../../../components/auth/auth-guard";
import { authHeaders } from "../../../../lib/auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type InvoiceOrder = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    product: {
      unit: string;
      supplier: { businessName: string };
    };
  }>;
  deliveryAddress: {
    recipientName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string | null;
    postalCode: string | null;
    country: string;
  };
  payment: {
    status: string;
    transactionRef: string | null;
    paidAt: string | null;
  } | null;
  invoice: {
    invoiceNumber: string;
    subtotal: string;
    deliveryFee: string;
    total: string;
    issuedAt: string;
  } | null;
};

const PAYMENT_LINES: Record<string, string> = {
  PENDING: "EFT reference recorded — awaiting supplier verification",
  PAID: "Paid via EFT (verified by the supplier)",
  FAILED: "EFT reference rejected — awaiting a corrected reference",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<InvoiceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}`, {
          cache: "no-store",
          headers: authHeaders(),
        });

        if (response.status === 404) {
          throw new Error("Order not found — it may belong to another account.");
        }

        if (!response.ok) {
          throw new Error("Unable to load this invoice");
        }

        const data = (await response.json()) as InvoiceOrder;

        if (!cancelled) {
          setOrder(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load this invoice",
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
  }, [orderId]);

  return (
    <AuthGuard allowedRoles={["BUYER", "SUPPLIER", "AGRO_DEALER", "ADMIN"]}>
      <main className="min-h-screen bg-[#f6f7f2] text-slate-900 print:bg-white">
        <header className="border-b border-[#dce2d9] bg-white print:hidden">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#17633a]">
                BonAgri
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Invoice
              </h1>
            </div>

            <div className="flex gap-2">
              <Link
                href={`/orders/${orderId}`}
                className="rounded-xl border border-[#dce2d9] bg-white px-4 py-2 text-sm font-medium text-[#344238] transition hover:bg-[#f7f8f4]"
              >
                ← Order details
              </Link>
              <button
                type="button"
                disabled={!order?.invoice}
                onClick={() => window.print()}
                className="rounded-xl bg-[#17633a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#12512f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Print / save PDF
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-3xl px-6 py-8">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#69756c]">Loading invoice...</p>
          ) : !order ? (
            <div className="rounded-2xl border border-dashed border-[#dce2d9] bg-white p-12 text-center">
              <h2 className="text-lg font-semibold">Invoice not found</h2>
              <p className="mt-2 text-sm text-[#69756c]">
                This order does not belong to your account.
              </p>
              <Link
                href="/"
                className="mt-6 inline-block rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Back to marketplace
              </Link>
            </div>
          ) : !order.invoice ? (
            <div className="rounded-2xl border border-dashed border-[#dce2d9] bg-white p-12 text-center">
              <h2 className="text-lg font-semibold">No invoice yet</h2>
              <p className="mt-2 text-sm text-[#69756c]">
                Invoices are issued automatically when the supplier confirms
                order {order.orderNumber}. It is still {order.status.toLowerCase()}{" "}
                right now.
              </p>
              <Link
                href={`/orders/${order.id}`}
                className="mt-6 inline-block rounded-xl bg-[#17633a] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#12512f]"
              >
                Back to order
              </Link>
            </div>
          ) : (
            <article className="rounded-2xl border border-[#dce2d9] bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none sm:p-10">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e3e8e0] pb-6">
                <div>
                  <p className="text-lg font-black tracking-tight text-[#17633a]">
                    BonAgri
                  </p>
                  <p className="mt-1 text-xs text-[#69756c]">
                    Agricultural marketplace · South Africa
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-[#7b867d]">
                    Tax invoice
                  </p>
                  <p className="mt-1 text-base font-black text-[#17251b]">
                    {order.invoice.invoiceNumber}
                  </p>
                  <p className="mt-1 text-xs text-[#69756c]">
                    Issued {formatDate(order.invoice.issuedAt)} · Order{" "}
                    {order.orderNumber}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 border-b border-[#e3e8e0] py-6 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    From
                  </p>
                  <p className="mt-2 text-sm font-bold text-[#17251b]">
                    {order.items[0]?.product.supplier.businessName ??
                      "BonAgri supplier"}
                  </p>
                  <p className="mt-1 text-xs text-[#69756c]">
                    Sold via the BonAgri marketplace
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                    Bill to
                  </p>
                  <p className="mt-2 text-sm font-bold text-[#17251b]">
                    {order.deliveryAddress.recipientName}
                  </p>
                  <p className="mt-1 text-xs text-[#69756c]">
                    {order.deliveryAddress.addressLine1}
                    {order.deliveryAddress.addressLine2
                      ? `, ${order.deliveryAddress.addressLine2}`
                      : ""}
                  </p>
                  <p className="text-xs text-[#69756c]">
                    {order.deliveryAddress.city}
                    {order.deliveryAddress.province
                      ? `, ${order.deliveryAddress.province}`
                      : ""}
                    {order.deliveryAddress.postalCode
                      ? ` ${order.deliveryAddress.postalCode}`
                      : ""}
                    , {order.deliveryAddress.country}
                  </p>
                </div>
              </div>

              <div className="py-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e3e8e0] text-left text-[10px] font-black uppercase tracking-[0.14em] text-[#7b867d]">
                      <th className="pb-2">Item</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Unit price</th>
                      <th className="pb-2 text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-[#f0f3ed] last:border-0"
                      >
                        <td className="py-3 font-bold text-[#344238]">
                          {item.productName}
                        </td>
                        <td className="py-3 text-right text-[#69756c]">
                          {item.quantity} {item.product.unit}
                        </td>
                        <td className="py-3 text-right text-[#69756c]">
                          R{item.unitPrice}
                        </td>
                        <td className="py-3 text-right font-bold text-[#17251b]">
                          R{item.lineTotal}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-5 ml-auto max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between text-[#69756c]">
                    <span>Subtotal</span>
                    <span>R{order.invoice.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-[#69756c]">
                    <span>Delivery fee</span>
                    <span>R{order.invoice.deliveryFee}</span>
                  </div>
                  <div className="flex justify-between border-t border-[#e3e8e0] pt-2 text-base font-black text-[#17633a]">
                    <span>Total</span>
                    <span>R{order.invoice.total}</span>
                  </div>
                </div>
              </div>

              {order.payment ? (
                <div className="rounded-xl border border-[#cfe0cf] bg-[#eaf3ec] px-4 py-3 text-xs text-[#17633a]">
                  <span className="font-black uppercase tracking-wide">
                    Payment
                  </span>{" "}
                  · {PAYMENT_LINES[order.payment.status] ?? order.payment.status}
                  {order.payment.transactionRef
                    ? ` (ref ${order.payment.transactionRef})`
                    : ""}
                </div>
              ) : null}

              <p className="mt-6 text-[10px] leading-4 text-[#7b867d]">
                Generated automatically by BonAgri when order{" "}
                {order.orderNumber} was confirmed. Goods supplied by the vendor
                named above; BonAgri facilitates the transaction.
              </p>
            </article>
          )}
        </div>
      </main>
    </AuthGuard>
  );
}
