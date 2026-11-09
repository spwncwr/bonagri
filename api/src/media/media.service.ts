import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { UploadKind } from "./dto/sign-upload.dto";
import type { UserRole } from "../common/types";

const CLOUDINARY_HOST = "res.cloudinary.com";
const CLOUDINARY_UPLOAD_URL = "https://api.cloudinary.com/v1_1";

// CP17: per-kind authorization. The endpoint used to accept any kind from
// any signed-in role; each kind now maps to the roles that may actually
// upload it (admins run the console kinds, vendors their own storefront,
// every account its avatar, suppliers/dealers their verification evidence).
const UPLOAD_ROLES: Record<UploadKind, readonly UserRole[]> = {
  product: ["SUPPLIER", "AGRO_DEALER", "ADMIN"],
  supplier_logo: ["SUPPLIER", "AGRO_DEALER", "ADMIN"],
  category: ["ADMIN"],
  banner: ["ADMIN"],
  promotion: ["ADMIN"],
  avatar: ["BUYER", "SUPPLIER", "AGRO_DEALER", "TRANSPORTER", "ADMIN"],
  verification_document: ["SUPPLIER", "AGRO_DEALER"],
};

// Private assets are only ever delivered through a signed URL. When the
// optional CLOUDINARY_AUTH_TOKEN_SECRET is configured (Cloudinary console →
// Settings → Security → Signed URL) the URL also expires; without it the
// signature itself still gates access to the private asset.
const DOCUMENT_URL_TTL_SECONDS = 300;
const VERIFICATION_FOLDER = "bonagri/verification/";

// CP16a: media foundation. The browser asks this API for an upload signature,
// uploads the file **directly to Cloudinary** (bytes never transit the API —
// the Render free tier has a 100kb JSON body limit and no reason to proxy
// megabytes), then submits the resulting secure_url with its entity form.
//
// The API owns three things:
//   1. signing  — authenticated suppliers get a signature for a
//      server-generated public_id (bonagri/<kind>/<uuid>), so clients cannot
//      squat arbitrary paths;
//   2. deriving — imagePublicId is parsed back out of the stored URL
//      **server-side** (never trusted from the client), so replacements can
//      destroy the old asset;
//   3. cleanup  — best-effort destroy of replaced assets.
//   4. private   — CP17 verification documents are signed as type=private
//      into bonagri/verification/ and delivered only via signDeliveryUrl()
//      after an owner-or-admin check in the verification module.
//
// Without CLOUDINARY_* env vars the signature endpoint answers 503 and the
// rest of the API keeps working (URL-paste fallback) — the local/CI smoke
// suite runs on this path.
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET,
    );
  }

  signUpload(kind: UploadKind, role: UserRole) {
    if (!UPLOAD_ROLES[kind]?.includes(role)) {
      throw new ForbiddenException(
        "Your account type cannot upload this kind of file",
      );
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException("Media storage not configured");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const isPrivate = kind === "verification_document";
    // Verification evidence lands in its own folder so a stray URL-paste or
    // folder listing can never mix it with public product imagery.
    const publicId = isPrivate
      ? `${VERIFICATION_FOLDER}${randomUUID()}`
      : `bonagri/${kind}/${randomUUID()}`;
    const params: Record<string, string | number> = isPrivate
      ? { public_id: publicId, timestamp, type: "private" }
      : { public_id: publicId, timestamp };
    const signature = cloudinary.utils.api_sign_request(params, apiSecret);

    return {
      cloudName,
      apiKey,
      uploadUrl: `${CLOUDINARY_UPLOAD_URL}/${cloudName}/image/upload`,
      timestamp,
      signature,
      publicId,
      // Private uploads must echo the signed `type` field back in the form;
      // public uploads send nothing extra (existing client keeps working).
      ...(isPrivate ? { type: "private" as const } : {}),
    };
  }

  // CP17: short-lived signed delivery URL for a private verification
  // document. Ownership/authorization is checked by the caller (owner of the
  // application or an admin) — this method only turns an already-authorized
  // publicId into a fetchable link. Never returns a permanent public URL.
  signDeliveryUrl(publicId: string): {
    url: string;
    expiresInSeconds: number | null;
  } {
    if (!publicId.startsWith(VERIFICATION_FOLDER)) {
      throw new BadRequestException("Invalid document reference");
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Media storage not configured");
    }

    this.applyConfig();

    const authSecret = process.env.CLOUDINARY_AUTH_TOKEN_SECRET;
    const url = cloudinary.url(publicId, {
      type: "private",
      sign_url: true,
      secure: true,
      ...(authSecret
        ? {
            auth_token: {
              key: authSecret,
              expiration:
                Math.floor(Date.now() / 1000) + DOCUMENT_URL_TTL_SECONDS,
            },
          }
        : {}),
    });

    return {
      url,
      expiresInSeconds: authSecret ? DOCUMENT_URL_TTL_SECONDS : null,
    };
  }

  // Derive our public_id back out of a stored Cloudinary URL. Only our own
  // cloud host counts; URLs without a vNNN/ segment (legacy/unsigned shapes)
  // and any other host yield null = "not a managed asset".
  derivePublicId(url?: string | null): string | null {
    if (!url) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    if (parsed.hostname.toLowerCase() !== CLOUDINARY_HOST) {
      return null;
    }

    // /<cloud>/image/upload/[<transform-segments>/]v<digits>/<public_id>[.<ext>]
    const match = parsed.pathname.match(
      /^\/[^/]+\/image\/upload\/(?:[^/]+\/)*v\d+\/(.+)$/,
    );
    if (!match) {
      return null;
    }

    const id =
      match[1].replace(/\.(jpe?g|png|webp|gif|avif|svg|bmp|tiff)$/i, "") ||
      null;
    if (!id) {
      return null;
    }

    // Only OUR folder is a managed asset. A URL from someone else's folder —
    // including another app sharing this Cloudinary account — must never be
    // derivable, or a replace/clear could destroy an asset we don't own.
    if (!id.startsWith("bonagri/")) {
      return null;
    }

    return id;
  }

  // The signing path passes the api_secret explicitly, but the SDK's own
  // operations (uploader.destroy) read the *global* Cloudinary config — which
  // nothing set, so destroy failed with "Must supply api_key". Found by the
  // CP16b live journey: signing worked while every cleanup silently 404'd on
  // a missing key. Applied per-call so env changes are picked up too.
  private applyConfig(): void {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return;
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  // Best-effort: an asset we no longer reference should go, but a Cloudinary
  // hiccup must never fail the product/logo update that triggered it.
  async destroyAsset(publicId?: string | null): Promise<void> {
    if (!publicId || !this.isConfigured()) {
      return;
    }

    this.applyConfig();

    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (error) {
      this.logger.warn(
        `Cloudinary destroy failed for ${publicId}: ${String(error)}`,
      );
    }
  }
}
