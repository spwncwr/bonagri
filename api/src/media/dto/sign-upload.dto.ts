import { IsIn } from "class-validator";

// CP16a: what the upload is for — decides the Cloudinary folder inside the
// server-generated public_id (bonagri/<kind>/<uuid>).
export type UploadKind =
  | "product"
  | "supplier_logo"
  | "category"
  | "banner"
  | "promotion"
  // Account settings: every role uploads exactly one kind of personal image,
  // the display picture on their settings screen.
  | "avatar"
  // CP17: business verification evidence. Signed as a Cloudinary *private*
  // asset into bonagri/verification/ — no public URL is ever issued; the API
  // serves it to the owner or an admin through a signed delivery URL.
  | "verification_document";

export class SignUploadDto {
  @IsIn([
    "product",
    "supplier_logo",
    "category",
    "banner",
    "promotion",
    "avatar",
    "verification_document",
  ])
  kind!: UploadKind;
}
