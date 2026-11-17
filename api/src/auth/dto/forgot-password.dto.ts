import { IsEmail } from "class-validator";

// HP4: the endpoint answers 202 for every address, so this DTO only has to
// shape-check the input — it must never be able to distinguish known from
// unknown accounts.
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}
