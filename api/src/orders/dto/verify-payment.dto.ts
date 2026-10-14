import { IsIn } from "class-validator";

export class VerifyPaymentDto {
  @IsIn(["PAID", "FAILED"])
  status!: "PAID" | "FAILED";
}
