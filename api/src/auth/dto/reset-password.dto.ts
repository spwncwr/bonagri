import { IsString, Length, MinLength } from "class-validator";

export class ResetPasswordDto {
  // 32 random bytes hex-encoded = 64 chars; the bounds reject obvious junk
  // before it reaches the database lookup (still always a generic error).
  @IsString()
  @Length(64, 64)
  token!: string;

  // Same floor as RegisterDto — a reset must not weaken the password policy.
  @IsString()
  @MinLength(8)
  password!: string;
}
