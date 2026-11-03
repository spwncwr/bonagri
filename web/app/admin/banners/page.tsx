"use client";

import { FormEvent, useEffect, useState } from "react";
import ImageUpload from "../../../components/media/image-upload";
import { ArrowRightIcon } from "../../../components/mobile/icons";
import { authHeaders } from "../../../lib/auth";
import { AdminRowsSkeleton } from "../../../components/admin/admin-ui";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  eyebrow: string | null;
  ctaText: string | null;
  ctaLink: string;
  imageUrl: string | null;
  tone: string | null;
  targetRole: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
};

const TONE_PRESETS = [
  { label: "Deep Emerald", value: "from-[#17633a] to-[#0c3f23]" },
  { label: "Forest Green", value: "from-[#1f7a45] to-[#113f27]" },
  { label: "Rich Olive", value: "from-[#166b3c] to-[#0e3a22]" },
  { label: "Warm Gold", value: "from-[#8c6d1f] to-[#4d3807]" },
  { label: "Earth Brown", value: "from-[#633a17] to-[#361d08]" },
];

export default function AdminBannersPage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create form state
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [eyebrow, setEyebrow] = useState("");
  const [ctaText, setCtaText] = useState("Shop now");
  const [ctaLink, setCtaLink] = useState("/explore");
  const [imageUrl, setImageUrl] = useState("");
  const [tone, setTone] = useState("from-[#17633a] to-[#0c3f23]");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  // Edit modal state
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editEyebrow, setEditEyebrow] = useState("");
  const [editCtaText, setEditCtaText] = useState("");
  const [editCtaLink, setEditCtaLink] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editTone, setEditTone] = useState("");
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [editIsActive, setEditIsActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadBanners() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/admin/banners`, {
          headers: authHeaders(),
        });
        if (!response.ok) throw new Error("Unable to load banners");
        const data = (await response.json()) as Banner[];
        if (!cancelled) setBanners(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load banners",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBanners();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/banners`, {
        headers: authHeaders(),
      });
      if (response.ok) {
        setBanners((await response.json()) as Banner[]);
      }
    } catch {
      // Best-effort
    }
  }

  async function handleCreateBanner(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/banners`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          eyebrow: eyebrow.trim() || undefined,
          ctaText: ctaText.trim() || undefined,
          ctaLink: ctaLink.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          tone: tone.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
          isActive,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to create banner");
      }

      setTitle("");
      setSubtitle("");
      setEyebrow("");
      setCtaText("Shop now");
      setCtaLink("/explore");
      setImageUrl("");
      setSortOrder(0);
      setIsActive(true);
      setSuccess("Banner created successfully!");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create banner");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(banner: Banner) {
    setEditingBanner(banner);
    setEditTitle(banner.title);
    setEditSubtitle(banner.subtitle ?? "");
    setEditEyebrow(banner.eyebrow ?? "");
    setEditCtaText(banner.ctaText ?? "Shop now");
    setEditCtaLink(banner.ctaLink);
    setEditImageUrl(banner.imageUrl ?? "");
    setEditTone(banner.tone ?? "from-[#17633a] to-[#0c3f23]");
    setEditSortOrder(banner.sortOrder);
    setEditIsActive(banner.isActive);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingBanner || !editTitle.trim()) return;

    setSavingEdit(true);
    setError("");

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/banners/${editingBanner.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            title: editTitle.trim(),
            subtitle: editSubtitle.trim() || null,
            eyebrow: editEyebrow.trim() || null,
            ctaText: editCtaText.trim() || "Shop now",
            ctaLink: editCtaLink.trim() || "/explore",
            imageUrl: editImageUrl.trim() ? editImageUrl.trim() : null,
            tone: editTone.trim(),
            sortOrder: Number(editSortOrder) || 0,
            isActive: editIsActive,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to update banner");
      }

      setEditingBanner(null);
      setSuccess("Banner updated successfully!");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update banner");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteBanner(id: string) {
    if (!confirm("Are you sure you want to delete this promotional banner?")) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/banners/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error("Failed to delete banner");
      setSuccess("Banner deleted.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete banner");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Ad & Promotional Banners
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload custom banner photos or create gradient promotional slides for
          the storefront carousel.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {success}
        </div>
      ) : null}

      {/* New Banner Form */}
      <form
        onSubmit={(e) => void handleCreateBanner(e)}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-base font-bold text-slate-900">Add New Banner</h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Eyebrow Tag (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. SPECIAL HARVEST, FOR SUPPLIERS"
              value={eyebrow}
              onChange={(e) => setEyebrow(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Banner Headline
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Fresh Mangoes & Citrus in Season"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Subtitle / Description
          </label>
          <input
            type="text"
            placeholder="e.g. Direct farm-gate crates delivered across Tzaneen and Polokwane."
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Button Text (CTA)
            </label>
            <input
              type="text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="Shop now"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Destination URL
            </label>
            <input
              type="text"
              required
              value={ctaLink}
              onChange={(e) => setCtaLink(e.target.value)}
              placeholder="/explore?cat=fruits or /apply"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
        </div>

        {/* Banner image & tone preset */}
        <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Banner Image & Styling
          </span>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-full sm:w-1/2 space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                Photo Upload
              </label>
              <ImageUpload
                kind="banner"
                value={imageUrl}
                onChange={setImageUrl}
              />
              <input
                type="url"
                placeholder="…or paste image URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-100"
              />
            </div>

            <div className="w-full sm:w-1/2 space-y-2">
              <label className="block text-xs font-medium text-slate-600">
                Fallback Gradient Tone
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TONE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setTone(p.value)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs font-medium transition ${
                      tone === p.value
                        ? "border-emerald-600 bg-white shadow-sm ring-2 ring-emerald-500"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full bg-gradient-to-br ${p.value}`}
                    />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Preview Card */}
          <div className="mt-4">
            <span className="mb-2 block text-xs font-semibold text-slate-500">
              Live Carousel Preview:
            </span>
            <div
              className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${tone} p-5 text-white shadow-sm`}
            >
              {imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
                </>
              ) : null}
              <div className="relative z-10 max-w-sm">
                <div className="text-[9px] font-black tracking-[0.2em] text-white/70">
                  {eyebrow || "BONAGRI"}
                </div>
                <div className="mt-1 text-lg font-black leading-tight tracking-tight">
                  {title || "Your Banner Headline Here"}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-white/80">
                  {subtitle || "Subtitle or promotional campaign highlights."}
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm">
                  {ctaText || "Learn more"}
                  <ArrowRightIcon className="h-3 w-3" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Display Order
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded text-emerald-700"
              />
              Active on Storefront
            </label>
          </div>

          <button
            type="submit"
            disabled={creating || !title.trim()}
            className="rounded-lg bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Adding..." : "Add Banner"}
          </button>
        </div>
      </form>

      {/* Existing Banners List */}
      <div>
        <h2 className="mb-4 text-base font-bold text-slate-900">
          Configured Banners ({banners.length})
        </h2>

        {loading ? (
          <AdminRowsSkeleton rows={2} label="Loading banners..." rowHeight="h-28" />
        ) : banners.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No dynamic banners configured yet. The storefront is using default
            built-in slides.
          </div>
        ) : (
          <div className="space-y-4">
            {banners.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${
                        b.tone ?? "from-[#17633a] to-[#0c3f23]"
                      } shadow-sm`}
                    >
                      {b.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.imageUrl}
                          alt={b.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] font-bold text-white/80">
                          Gradient
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                            b.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {b.isActive ? "Active" : "Disabled"}
                        </span>
                        <span className="text-xs text-slate-400">
                          Order: {b.sortOrder}
                        </span>
                        {b.eyebrow ? (
                          <span className="text-xs font-semibold text-emerald-700">
                            • {b.eyebrow}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-1 text-sm font-bold text-slate-900">
                        {b.title}
                      </h3>
                      {b.subtitle ? (
                        <p className="mt-0.5 text-xs text-slate-600 line-clamp-1">
                          {b.subtitle}
                        </p>
                      ) : null}
                      <div className="mt-1 text-xs text-slate-400">
                        Link:{" "}
                        <span className="font-mono text-slate-600">
                          {b.ctaLink}
                        </span>{" "}
                        ({b.ctaText ?? "Shop now"})
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => startEdit(b)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteBanner(b.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingBanner ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Edit Banner</h2>

            <form
              onSubmit={(e) => void handleSaveEdit(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Headline
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Subtitle
                </label>
                <input
                  type="text"
                  value={editSubtitle}
                  onChange={(e) => setEditSubtitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Eyebrow Tag
                  </label>
                  <input
                    type="text"
                    value={editEyebrow}
                    onChange={(e) => setEditEyebrow(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Button Text
                  </label>
                  <input
                    type="text"
                    value={editCtaText}
                    onChange={(e) => setEditCtaText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Destination URL
                </label>
                <input
                  type="text"
                  required
                  value={editCtaLink}
                  onChange={(e) => setEditCtaLink(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Banner Image
                </label>
                <ImageUpload
                  kind="banner"
                  value={editImageUrl}
                  onChange={setEditImageUrl}
                />
                <input
                  type="url"
                  placeholder="…or paste image URL"
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                />
                {editImageUrl ? (
                  <button
                    type="button"
                    onClick={() => setEditImageUrl("")}
                    className="mt-1 text-xs text-red-600 hover:underline"
                  >
                    Remove photo (revert to gradient)
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Order
                  </label>
                  <input
                    type="number"
                    value={editSortOrder}
                    onChange={(e) => setEditSortOrder(Number(e.target.value))}
                    className="w-20 rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                    className="h-4 w-4 rounded text-emerald-700"
                  />
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingBanner(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit || !editTitle.trim()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
