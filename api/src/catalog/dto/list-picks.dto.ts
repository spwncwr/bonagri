import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

// "Picked for you" rail read: how many personalized picks to return.
// The rail asks for 12; the cap keeps one caller from pulling a whole page
// of affinity-ranked rows.
export class ListPicksDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  take: number = 12;
}
