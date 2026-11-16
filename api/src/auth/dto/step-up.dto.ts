import { IsString, MinLength } from "class-validator";

// HP3: step-up re-authentication. The caller is already signed in — this only
// re-proves the password for a dangerous action (plan G3).
export class StepUpDto {
  @IsString()
  @MinLength(8)
  password!: string;
}
