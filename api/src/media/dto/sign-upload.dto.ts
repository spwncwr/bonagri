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
  | "avatar";

export class SignUploadDto {
  @IsIn([
    "product",
    "supplier_logo",
    "category",
    "banner",
    "promotion",
    "avatar",
  ])
  kind!: UploadKind;
}
