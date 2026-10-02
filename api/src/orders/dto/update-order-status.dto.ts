import { IsIn } from "class-validator";

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
}
