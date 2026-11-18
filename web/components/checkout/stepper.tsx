"use client";

import Link from "next/link";

// C1 (plan §6): a visible Cart → Delivery → Payment stepper so the split
// never feels like hidden extra steps. Completed steps are links (the buyer
// can step back to edit), the current step is marked with aria-current, and
// upcoming steps are inert — the flow runs in order.
export type CheckoutStep = "cart" | "delivery" | "payment";

const STEPS: { id: CheckoutStep; label: string; href: string }[] = [
  { id: "cart", label: "Cart", href: "/cart" },
  { id: "delivery", label: "Delivery", href: "/checkout/delivery" },
  { id: "payment", label: "Payment", href: "/checkout" },
];

type Props = {
  current: CheckoutStep;
};

export default function CheckoutStepper({ current }: Props) {
  const activeIndex = STEPS.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Checkout steps">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const isCurrent = index === activeIndex;

          const badge = (
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                done || isCurrent
                  ? "bg-[#17633a] text-white"
                  : "border border-[#cfd8ce] bg-white text-[#9aa49b]"
              }`}
            >
              {index + 1}
            </span>
          );

          const label = (
            <span
              className={`text-[11px] font-black uppercase tracking-[0.12em] ${
                isCurrent
                  ? "text-[#17633a]"
                  : done
                    ? "text-[#344238]"
                    : "text-[#9aa49b]"
              }`}
            >
              {step.label}
            </span>
          );

          const content = (
            <span className="flex items-center gap-1.5">
              {badge}
              {label}
            </span>
          );

          return (
            <li key={step.id} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className={`h-px w-5 sm:w-8 ${
                    index <= activeIndex ? "bg-[#17633a]" : "bg-[#dce2d9]"
                  }`}
                />
              ) : null}

              {done ? (
                <Link
                  href={step.href}
                  className="rounded-full transition hover:opacity-80"
                >
                  {content}
                </Link>
              ) : isCurrent ? (
                <span aria-current="step" className="flex items-center">
                  {content}
                </span>
              ) : (
                <span className="flex items-center">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
