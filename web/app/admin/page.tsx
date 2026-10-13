"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthGuard from "../../components/auth/auth-guard";
import { fetchCurrentUser, type AuthUser } from "../../lib/auth";

const sections = [
  {
    title: "Dashboard",
    description: "Platform statistics: users, orders and revenue.",
    status: "Coming in CP3",
  },
  {
    title: "Users",
    description:
      "Suspend, activate and promote accounts (buyer, supplier, agro dealer).",
    status: "Coming in CP3",
  },
  {
    title: "Suppliers",
    description: "Review and verify supplier and dealer profiles.",
    status: "Coming in CP3",
  },
  {
    title: "Categories",
    description: "Manage marketplace categories.",
    status: "Coming in CP3",
  },
  {
    title: "Orders",
    description: "Platform-wide order overview.",
    status: "Coming in CP3",
  },
  {
    title: "Disputes",
    description: "Review and resolve buyer disputes.",
    status: "Coming in CP5",
  },
];

export default function AdminPage() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchCurrentUser().then((currentUser) => {
      if (!cancelled) {
        setUser(currentUser);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthGuard requiredRole="ADMIN">
      <main className="min-h-screen bg-slate-50 px-6 py-12">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <Link
                href="/"
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                ← Back to BonAgri
              </Link>

              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
                Admin console
              </h1>

              <p className="mt-2 text-sm text-slate-600">
                Signed in as{" "}
                <span className="font-medium text-slate-900">
                  {user ? `${user.firstName} ${user.lastName}` : "…"}
                </span>{" "}
                — platform management for the BonAgri marketplace.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The admin console is under construction. Foundations (CP0) are live:
            this account can already view every order via the API. Management
            screens arrive with CP3, disputes with CP5.
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
              <div
                key={section.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">
                    {section.title}
                  </h2>

                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {section.status}
                  </span>
                </div>

                <p className="mt-2 text-sm text-slate-600">
                  {section.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
