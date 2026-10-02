import { IsInt, IsOptional, Min } from "class-validator";

export class UpdateInventoryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockLevel?: number;
}
