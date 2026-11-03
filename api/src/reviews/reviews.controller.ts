import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ThrottlerGuard } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CreateReviewDto } from "./dto/create-review.dto";
import { ReviewsService } from "./reviews.service";

type AuthenticatedRequest = Request & {
  user: { id: string; role: string };
};

// CP17: product reviews. Public read (the cards + product screen need the
// list without a session), writes are buyer-only and eligibility is checked
// in the service (delivered order containing the product, one review each).
@Controller("products")
@UseGuards(ThrottlerGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get(":id/reviews")
  list(@Param("id") id: string) {
    return this.reviewsService.list(id);
  }

  @Get(":id/reviews/mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  mine(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.reviewsService.mine(request.user.id, id);
  }

  @Post(":id/reviews")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("BUYER")
  create(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.create(request.user.id, id, dto);
  }
}
