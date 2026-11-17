import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // HP5: rememberMe only widens the REFRESH cookie (30 days vs browser
  // session) — the access token is always short-lived either way.
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
