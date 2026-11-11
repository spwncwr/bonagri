// CP16b: Cloudinary helpers for the web client.
//
// 1. URL builder — injects CDN transformations (w_/q_auto/f_auto) into OUR
//    stored Cloudinary URLs so the browser downloads a right-sized,
//    auto-format image instead of the full-resolution original. Non-Cloudinary
//    URLs (the external paste fallback) pass through untouched.
// 2. Upload helper — asks our API for a short-lived signature, then uploads
//    the file DIRECTLY to Cloudinary (bytes never transit the API; Render's
//    free tier has a 100kb JSON body limit anyway).
import { authHeaders } from "./auth";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://" + "localhost" + ":3000";

const CLOUDINARY_HOST = "res.cloudinary.com";

// Client-side guardrails; Cloudinary also enforces these server-side.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

export type UploadKind =
  | "product"
  | "supplier_logo"
  | "category"
  | "banner"
  | "promotion"
  // Account settings: the display picture any signed-in account may upload.
  | "avatar"
  // CP17: business verification evidence — a Cloudinary *private* asset in
  // bonagri/verification/. No public URL is kept; the API serves it through
  // a signed short-lived delivery link instead.
  | "verification_document";

type UploadSignature = {
  cloudName: string;
  apiKey: string;
  uploadUrl: string;
  timestamp: number;
  signature: string;
  publicId: string;
  // Present only for private (verification_document) uploads — must be
  // echoed back in the form so Cloudinary stores the asset private.
  type?: "private";
};

// CP17: document rules mirror the API's validation — JPEG/PNG/WebP/AVIF or
// PDF, 5 MB max (same ceiling as images).
export const ACCEPTED_DOCUMENT_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf",
];

export function validateVerificationDocument(file: File): string | null {
  if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
    return "Use a JPEG, PNG, WebP, AVIF image or a PDF.";
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return "Each document must be 5 MB or smaller.";
  }

  return null;
}

// The API answers 503 when CLOUDINARY_* env vars are absent — that is a
// configuration state, not a user error, so callers surface a hint instead
// of a red failure (the URL-paste fallback keeps working).
export class MediaNotConfiguredError extends Error {
  constructor() {
    super("Media storage is not configured on this server");
    this.name = "MediaNotConfiguredError";
  }
}

export function isCloudinaryUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === CLOUDINARY_HOST &&
      parsed.pathname.includes("/image/upload/")
    );
  } catch {
    return false;
  }
}

// width 640 (cards) / 80 (thumbs) / 800 (modal) are the sizes we render at.
// Returns null when there is no URL to show.
export function buildImageUrl(
  url: string | null | undefined,
  width = 640,
): string | null {
  if (!url) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.hostname.toLowerCase() !== CLOUDINARY_HOST) {
    return url; // external paste — serve as-is
  }

  const marker = "/image/upload/";
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex === -1) {
    return url;
  }

  const rest = parsed.pathname.slice(markerIndex + marker.length);

  // Only transform pristine upload URLs (…/upload/vNN/<id>). Anything with an
  // existing transformation or an unexpected shape passes through untouched
  // so we can never double-transform or corrupt a stored URL.
  if (!/^v\d+\//.test(rest)) {
    return url;
  }

  parsed.pathname = `${parsed.pathname.slice(0, markerIndex)}${marker}w_${width},q_auto,f_auto/${rest}`;
  return parsed.toString();
}

// Returns an error message, or null when the file is acceptable.
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Use a JPEG, PNG, WebP or AVIF image.";
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 5 MB or smaller — try a smaller photo.";
  }

  return null;
}

async function requestUploadSignature(
  kind: UploadKind,
): Promise<UploadSignature> {
  const response = await fetch(`${API_BASE_URL}/api/media/signature`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kind }),
  });

  if (response.status === 503) {
    throw new MediaNotConfiguredError();
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Your session expired — sign in again to upload.");
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(data?.message)
      ? data.message.join(", ")
      : data?.message;
    throw new Error(message || "Unable to start the image upload.");
  }

  return (await response.json()) as UploadSignature;
}

async function uploadToCloudinary(
  file: File,
  signature: UploadSignature,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", signature.apiKey);
  form.append("timestamp", String(signature.timestamp));
  form.append("signature", signature.signature);
  form.append("public_id", signature.publicId);
  // Private uploads (CP17 verification documents) sign `type=private` —
  // Cloudinary requires the same field in the form to honour it.
  if (signature.type) {
    form.append("type", signature.type);
  }

  const response = await fetch(signature.uploadUrl, {
    method: "POST",
    body: form,
  });

  const data = (await response.json().catch(() => null)) as {
    secure_url?: string;
    error?: { message?: string };
  } | null;

  if (!response.ok || !data?.secure_url) {
    throw new Error(
      data?.error?.message || "The upload to Cloudinary failed — try again.",
    );
  }

  return data.secure_url;
}

// Full flow: sign with our API → upload straight to Cloudinary → return the
// https secure_url to store on the entity (same shape as a pasted URL).
export async function uploadImage(
  file: File,
  kind: UploadKind,
): Promise<string> {
  const signature = await requestUploadSignature(kind);
  return uploadToCloudinary(file, signature);
}

// CP17: verification documents never store a URL — the API re-derives the
// asset from its server-issued publicId and serves it through a signed
// delivery link. Upload errors surface the same way as images.
export async function uploadVerificationDocument(
  file: File,
): Promise<{ publicId: string }> {
  const problem = validateVerificationDocument(file);
  if (problem) {
    throw new Error(problem);
  }

  const signature = await requestUploadSignature("verification_document");
  await uploadToCloudinary(file, signature);
  return { publicId: signature.publicId };
}
