import { IsString, Length } from "class-validator";

export class EnableTwoFactorDto {
  // The 6-digit TOTP from the authenticator app (spacing tolerated — the
  // service strips it before comparing).
  @IsString()
  @Length(6, 10)
  code!: string;
}
