import { IsString, Length } from "class-validator";

export class VerifyTwoFactorDto {
  // Either the 6-digit TOTP or a single-use recovery code.
  @IsString()
  @Length(6, 20)
  code!: string;
}
