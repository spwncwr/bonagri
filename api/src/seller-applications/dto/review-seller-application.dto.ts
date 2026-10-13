import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewSellerApplicationDto {
  @IsIn(["APPROVED", "REJECTED"])
  status!: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
