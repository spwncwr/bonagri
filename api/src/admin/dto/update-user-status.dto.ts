import { IsIn } from "class-validator";

export class UpdateUserStatusDto {
  @IsIn(["ACTIVE", "SUSPENDED"])
  status!: "ACTIVE" | "SUSPENDED";
}
