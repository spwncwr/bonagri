import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdateOrderStatusDto {
  @IsIn([
    "CONFIRMED",
    "PROCESSING",
    "READY_FOR_DELIVERY",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "CANCELLED",
  ])
  status!:
    | "CONFIRMED"
    | "PROCESSING"
    | "READY_FOR_DELIVERY"
    | "OUT_FOR_DELIVERY"
    | "DELIVERED"
    | "CANCELLED";

  // CP12: optional delivery tracking details — only accepted together with
  // status OUT_FOR_DELIVERY (enforced in the service).
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  driverName?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(30)
  driverPhone?: string;

  @IsOptional()
  @IsDateString()
  estimatedDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  trackingNumber?: string;
}
