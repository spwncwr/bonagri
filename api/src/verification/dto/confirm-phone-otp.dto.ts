import { IsString, Matches } from "class-validator";

export class ConfirmPhoneOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "The code is 6 digits" })
  code!: string;
}
