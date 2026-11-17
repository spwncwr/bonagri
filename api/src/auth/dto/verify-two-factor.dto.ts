import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class VerifyTwoFactorDto {
  // Either the 6-digit TOTP or a single-use recovery code.
  @IsString()
  @Length(6, 20)
  code!: string;

  // HP5: mirrors LoginDto — persists the refresh cookie across browser
  // restarts; absent/false keeps it a browser-session cookie.
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
