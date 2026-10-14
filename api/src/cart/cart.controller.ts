import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CartService } from "./cart.service";
import { AddCartItemDto } from "./dto/add-cart-item.dto";
import { UpdateCartItemDto } from "./dto/update-cart-item.dto";
import { CheckoutDto } from "./dto/checkout.dto";

@Controller("cart")
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  getCart(@Req() request: { user: { id: string } }) {
    return this.cartService.getCart(request.user.id);
  }

  @Post("items")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  addItem(
    @Req() request: { user: { id: string } },
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(request.user.id, dto);
  }

  @Patch("items/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  updateItem(
    @Req() request: { user: { id: string } },
    @Param("id") id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(request.user.id, id, dto);
  }

  @Delete("items/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  removeItem(
    @Req() request: { user: { id: string } },
    @Param("id") id: string,
  ) {
    return this.cartService.removeItem(request.user.id, id);
  }

  @Delete()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  clearCart(@Req() request: { user: { id: string } }) {
    return this.cartService.clearCart(request.user.id);
  }

  @Post("checkout")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  checkout(
    @Req() request: { user: { id: string } },
    @Body() dto: CheckoutDto,
  ) {
    return this.cartService.checkout(request.user.id, dto);
  }
}
