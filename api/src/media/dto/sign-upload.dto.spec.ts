import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SignUploadDto } from "./sign-upload.dto";

describe("SignUploadDto (CP16a)", () => {
  it("accepts the known upload kinds", async () => {
    for (const kind of ["product", "supplier_logo"]) {
      const dto = plainToInstance(SignUploadDto, { kind });
      await expect(validate(dto)).resolves.toEqual([]);
    }
  });

  it("rejects unknown kinds and missing kind", async () => {
    for (const payload of [{ kind: "delivery_photo" }, {}, { kind: 42 }]) {
      const dto = plainToInstance(SignUploadDto, payload);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
