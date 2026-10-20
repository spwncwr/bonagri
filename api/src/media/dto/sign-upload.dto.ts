import { IsIn } from "class-validator";

// CP16a: what the upload is for — decides the Cloudinary folder inside the
// server-generated public_id (bonagri/<kind>/<uuid>).
export type UploadKind = "product" | "supplier_logo";

export class SignUploadDto {
  @IsIn(["product", "supplier_logo"])
  kind!: UploadKind;
}
