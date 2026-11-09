import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";

// Loose international/SA formats: +27 12 345 6789, 012 345 6789, 27123456789.
// Normalisation (stripping spaces/dashes/parens) happens in the service.
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-().]{6,19}$/;

export class SendPhoneOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  @Matches(PHONE_PATTERN, {
    message: "Enter a valid phone number (e.g. 082 123 4567)",
  })
  phone!: string;
}
