import { IsIn } from "class-validator";

export class UpdateRequestResponseDto {
  @IsIn(["ACCEPTED", "DECLINED", "WITHDRAWN"])
  status!: "ACCEPTED" | "DECLINED" | "WITHDRAWN";
}
