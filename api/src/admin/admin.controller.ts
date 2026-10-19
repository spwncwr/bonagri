import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AdminService } from "./admin.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto";
import { PromoteSupplierDto } from "./dto/promote-supplier.dto";
import { PromoteTransporterDto } from "./dto/promote-transporter.dto";
import { UpdateSupplierVerifyDto } from "./dto/update-supplier-verify.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  getStats() {
    return this.adminService.getStats();
  }

  @Get("users")
  getUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.getUsers(query);
  }

  @Patch("users/:id/status")
  updateUserStatus(
    @Param("id") id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, dto);
  }

  @Post("users/:id/promote-supplier")
  promoteToSupplier(
    @Param("id") id: string,
    @Body() dto: PromoteSupplierDto,
  ) {
    return this.adminService.promoteToSupplier(id, dto);
  }

  // CP14: transporter management (promote, list, verify toggle).
  @Post("users/:id/promote-transporter")
  promoteToTransporter(
    @Param("id") id: string,
    @Body() dto: PromoteTransporterDto,
  ) {
    return this.adminService.promoteToTransporter(id, dto);
  }

  @Get("transporters")
  getTransporters(@Query("verified") verified?: string) {
    return this.adminService.listTransporters(
      verified === undefined ? undefined : verified === "true",
    );
  }

  @Patch("transporters/:id")
  setTransporterVerified(
    @Param("id") id: string,
    @Body() dto: UpdateSupplierVerifyDto,
  ) {
    return this.adminService.setTransporterVerified(id, dto);
  }

  @Get("suppliers")
  getSupplierProfiles() {
    return this.adminService.getSupplierProfiles();
  }

  @Patch("suppliers/:id")
  setSupplierVerified(
    @Param("id") id: string,
    @Body() dto: UpdateSupplierVerifyDto,
  ) {
    return this.adminService.setSupplierVerified(id, dto);
  }

  @Post("categories")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Patch("categories/:id")
  updateCategory(
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminService.updateCategory(id, dto);
  }
}
