import { IsBoolean } from "class-validator";

export class UpdateSupplierVerifyDto {
  @IsBoolean()
  verified!: boolean;
}
