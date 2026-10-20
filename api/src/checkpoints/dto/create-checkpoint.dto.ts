import { Type } from "class-transformer";
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const CHECKPOINT_TYPES = [
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
] as const;

export type CheckpointTypeValue = (typeof CHECKPOINT_TYPES)[number];

// CP15a: a checkpoint is an evidence record, not a state transition — the
// ledger write never drives OrderStatus/DeliveryStatus (CP14 stays source
// of truth). Flags are computed server-side at insert from these inputs.
export class CreateCheckpointDto {
  @IsIn(CHECKPOINT_TYPES)
  type!: CheckpointTypeValue;

  // GPS is optional (devices deny location); when present it must be a pair.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyM?: number;

  // Client capture time; defaults to server time when not supplied. Skew vs
  // the server's recordedAt is flagged (CLOCK_SKEW), never rejected.
  @IsOptional()
  @IsISO8601()
  clientAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
