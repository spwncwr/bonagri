import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: "BUYER" | "SUPPLIER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
  };
};

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("categories")
  getCategories() {
    return this.catalogService.getCategories();
  }

  @Get("products")
  getProducts(
    @Query("search") search?: string,
    @Query("category") categorySlug?: string,
  ) {
    return this.catalogService.getProducts(search, categorySlug);
  }

  @Get("supplier/inventory")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "ADMIN")
  getSupplierInventory(@Req() request: AuthenticatedRequest) {
    return this.catalogService.getSupplierInventory(request.user.id);
  }

  @Patch("supplier/inventory/:productId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER", "ADMIN")
  updateSupplierInventory(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.catalogService.updateSupplierInventory(
      request.user.id,
      productId,
      dto,
    );
  }

  @Get("products/:id")
  getProduct(@Param("id") id: string) {
    return this.catalogService.getProduct(id);
  }

  @Post("products")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER")
  createProduct(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalogService.createProduct(request.user.id, dto);
  }

  @Patch("products/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("SUPPLIER")
  updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(
      id,
      request.user.id,
      dto,
    );
  }
}
