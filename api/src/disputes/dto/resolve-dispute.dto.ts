import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ResolveDisputeDto {
  @IsIn(["UNDER_REVIEW", "RESOLVED", "REJECTED"])
  status!: "UNDER_REVIEW" | "RESOLVED" | "REJECTED";

  // Required (non-empty) when closing a dispute (RESOLVED / REJECTED).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}
