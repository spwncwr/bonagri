import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class SendMessageDto {
  // F2: text-only MVP — one plain body per message. Media, attachments and
  // formatting are explicitly out of scope (plan §F2 / risk 7).
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}
