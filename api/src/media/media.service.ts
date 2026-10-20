import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { UploadKind } from "./dto/sign-upload.dto";

const CLOUDINARY_HOST = "res.cloudinary.com";
const CLOUDINARY_UPLOAD_URL = "https://api.cloudinary.com/v1_1";

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

  signUpload(kind: UploadKind) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException("Media storage not configured");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `bonagri/${kind}/${randomUUID()}`;
    const signature = cloudinary.utils.api_sign_request(
      { public_id: publicId, timestamp },
      apiSecret,
    );

    return {
      cloudName,
      apiKey,
      uploadUrl: `${CLOUDINARY_UPLOAD_URL}/${cloudName}/image/upload`,
      timestamp,
      signature,
      publicId,
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

    return (
      match[1].replace(/\.(jpe?g|png|webp|gif|avif|svg|bmp|tiff)$/i, "") ||
      null
    );
  }

  // Best-effort: an asset we no longer reference should go, but a Cloudinary
  // hiccup must never fail the product/logo update that triggered it.
  async destroyAsset(publicId?: string | null): Promise<void> {
    if (!publicId || !this.isConfigured()) {
      return;
    }

    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (error) {
      this.logger.warn(
        `Cloudinary destroy failed for ${publicId}: ${String(error)}`,
      );
    }
  }
}
