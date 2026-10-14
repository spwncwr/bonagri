import { IsString, MinLength } from "class-validator";

export class RecordPaymentDto {
  @IsString()
  @MinLength(3)
  transactionRef!: string;
}
