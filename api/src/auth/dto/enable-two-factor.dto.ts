import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class EnableTwoFactorDto {
  // The 6-digit TOTP from the authenticator app (spacing tolerated — the
  // service strips it before comparing).
  @IsString()
  @Length(6, 10)
  code!: string;

  // HP5: enrolment-as-login hands back a real session, so it carries the
  // same rememberMe flag as the password step it came from.
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
