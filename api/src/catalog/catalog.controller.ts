import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateInventoryDto } from "./dto/update-inventory.dto";

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
  getSupplierInventory(@Query("userId") userId?: string) {
    if (!userId) {
      throw new BadRequestException("userId is required");
    }

    return this.catalogService.getSupplierInventory(userId);
  }

  @Patch("supplier/inventory/:productId")
  updateSupplierInventory(
    @Param("productId") productId: string,
    @Query("userId") userId: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.catalogService.updateSupplierInventory(
      userId,
      productId,
      dto,
    );
  }

  @Get("products/:id")
  getProduct(@Param("id") id: string) {
    return this.catalogService.getProduct(id);
  }

  @Post("products")
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  @Patch("products/:id")
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(id, dto);
  }
}
