import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  // Optional: generated from the name when omitted.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsUrl({ protocols: ["https", "http"], require_protocol: true })
  imageUrl?: string;
}
