import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

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
  imageUrl?: string | null;
}
