import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export const BROADCAST_ROLES = [
  "ALL",
  "BUYER",
  "SUPPLIER",
  "AGRO_DEALER",
  "TRANSPORTER",
] as const;

export type BroadcastRole = (typeof BROADCAST_ROLES)[number];

export class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;

  @IsIn(BROADCAST_ROLES)
  targetRole!: BroadcastRole;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
