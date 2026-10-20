import { Type } from "class-transformer";
import { IsNumber, Max, Min } from "class-validator";

// CP15a: the farm reference pin is the coordinate pair — a pin with a
// missing half is not a pin, so both are required.
export class UpdateSupplierPinDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}
