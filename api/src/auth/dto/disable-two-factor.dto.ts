import { IsString, Length, MinLength } from "class-validator";

export class DisableTwoFactorDto {
  // Disabling 2FA re-proves the account: password AND a current code (TOTP,
  // or a recovery code for the lost-device path).
  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @Length(6, 20)
  code!: string;
}
