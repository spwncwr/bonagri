import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class OpenDisputeDto {
  @IsIn(["NOT_DELIVERED", "WRONG_ITEM", "DAMAGED", "OTHER"])
  reason!: "NOT_DELIVERED" | "WRONG_ITEM" | "DAMAGED" | "OTHER";

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}
