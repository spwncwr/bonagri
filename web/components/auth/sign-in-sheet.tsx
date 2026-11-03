"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BrandIcon } from "../brand/logo";

export default function SignInSheet({
  open,
  action,
  onClose,
}: {
  open: boolean;
  action: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-sheet-title"
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 sm:items-center sm:px-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-6"
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />

        <BrandIcon size={52} className="rounded-2xl" />

        <h2
          id="signin-sheet-title"
          className="mt-4 text-xl font-black tracking-tight text-[#17251b]"
        >
          Sign in to {action ?? "continue"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#69756c]">
          Browse and search freely. You only need an account when you buy,
          order or sell on BonAgri.
        </p>

        <Link
          href="/login"
          onClick={onClose}
          className="mt-6 flex w-full items-center justify-center rounded-full bg-[#17633a] py-3.5 text-sm font-black text-white transition hover:bg-[#0f4d2b]"
        >
          Sign in
        </Link>

        <Link
          href="/register"
          onClick={onClose}
          className="mt-2 flex w-full items-center justify-center rounded-full border border-[#ccd5ca] bg-white py-3.5 text-sm font-black text-[#243229] transition hover:bg-[#f2f4ef]"
        >
          Create an account
        </Link>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full py-2 text-xs font-bold text-[#7b867d] transition hover:text-[#344238]"
        >
          Keep browsing
        </button>
      </div>
    </div>
  );
}
