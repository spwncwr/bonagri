import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantity!: number;
}
