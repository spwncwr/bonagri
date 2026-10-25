"use client";

// CP16b: photo picker that uploads straight to Cloudinary.
// Bound to a plain string URL (the same state the URL-paste field uses), so
// both inputs stay in sync and any page can adopt it with one useState.
import { useRef, useState } from "react";
import {
  buildImageUrl,
  MediaNotConfiguredError,
  uploadImage,
  validateImageFile,
  type UploadKind,
} from "../../lib/media";

type Props = {
  kind: UploadKind;
  value: string;
  onChange: (url: string) => void;
};

export default function ImageUpload({ kind, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File | null | undefined) {
    if (!file) {
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setBusy(true);

    try {
      const url = await uploadImage(file, kind);
      onChange(url);
    } catch (uploadError) {
      if (uploadError instanceof MediaNotConfiguredError) {
        setNotConfigured(true);
      } else {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Upload failed — try again.",
        );
      }
    } finally {
      setBusy(false);
      // allow re-picking the same file after a retry
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  const previewUrl = buildImageUrl(value, 320);

  return (
    <div>
      <div className="flex items-start gap-4">
        {/* Preview of the current URL (uploaded or pasted). */}
        <div
          className={`relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#dce2d9] bg-[#f4f6f1] ${previewUrl ? "" : "border-dashed"}`}
        >
          {previewUrl ? (
            // Plain <img>: Cloudinary transforms this to preview size, so a
            // Next image proxy would only burn Render free-tier CPU.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Current product"
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="px-2 text-center text-[10px] font-bold uppercase tracking-wide text-[#7b867d]">
              No photo
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <label
            htmlFor={`photo-upload-${kind}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFile(event.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-3 text-center transition ${
              dragOver
                ? "border-emerald-600 bg-emerald-50"
                : "border-[#cfd8cc] bg-white hover:border-emerald-600 hover:bg-emerald-50/50"
            } ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <input
              ref={inputRef}
              id={`photo-upload-${kind}`}
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
              }}
            />
            <span className="text-sm font-bold text-[#17633a]">
              {busy
                ? "Uploading to Cloudinary…"
                : value
                  ? "Replace photo"
                  : "Upload a photo"}
            </span>
            <span className="mt-1 text-xs text-[#69756c]">
              Click or drop an image — JPEG, PNG, WebP, max 5 MB
            </span>
          </label>

          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setError("");
              }}
              className="mt-2 text-xs font-bold uppercase tracking-wide text-[#7b867d] hover:text-red-600"
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      ) : null}

      {notConfigured ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Direct photo upload isn&apos;t enabled on this server yet — paste an
          image URL below instead.
        </p>
      ) : null}
    </div>
  );
}
