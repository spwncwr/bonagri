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
import type { Request } from "express";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";
import { AddressesService } from "./addresses.service";

type AuthenticatedRequest = Request & {
  user: {
    id: string;
  };
};

@Controller("addresses")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("BUYER")
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  getBuyerAddresses(@Req() request: AuthenticatedRequest) {
    return this.addressesService.getBuyerAddresses(request.user.id);
  }

  @Post()
  createBuyerAddress(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressesService.createBuyerAddress(
      request.user.id,
      dto,
    );
  }

  @Patch(":id")
  updateBuyerAddress(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.updateBuyerAddress(
      request.user.id,
      id,
      dto,
    );
  }

  @Delete(":id")
  deleteBuyerAddress(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.addressesService.deleteBuyerAddress(
      request.user.id,
      id,
    );
  }
}
