import { IsOptional, IsString, IsUUID } from "class-validator";

// CP14: re-dispatch a FAILED delivery either to a specific transporter or
// (omitted) back to the open board / self-delivery.
export class RedispatchDeliveryDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  transporterId?: string;
}
