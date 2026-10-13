import { IsIn, IsOptional, IsString } from "class-validator";

export class ListUsersQueryDto {
  @IsOptional()
  @IsIn(["BUYER", "SUPPLIER", "AGRO_DEALER", "ADMIN"])
  role?: "BUYER" | "SUPPLIER" | "AGRO_DEALER" | "ADMIN";

  @IsOptional()
  @IsIn(["ACTIVE", "SUSPENDED", "PENDING"])
  status?: "ACTIVE" | "SUSPENDED" | "PENDING";

  @IsOptional()
  @IsString()
  search?: string;
}
