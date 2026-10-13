import { IsIn } from "class-validator";

export class UpdateProductRequestDto {
  @IsIn(["FULFILLED", "WITHDRAWN"])
  status!: "FULFILLED" | "WITHDRAWN";
}
