import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PromotionsService } from "./promotions.service";
import {
  ListPromotionsDto,
  TrackPromoEventsDto,
} from "./dto/promotions.dto";

// Public, anonymous reads: campaigns and their destinations are public
// marketplace data by design. Only ACTIVE/scheduled-and-started campaigns are
// resolved; admin fields and analytics never leave this controller.
@Controller("promotions")
@UseGuards(ThrottlerGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  getPromotions(@Query() query: ListPromotionsDto) {
    return this.promotionsService.getActivePromotions(query);
  }

  @Post("events")
  trackEvents(@Body() dto: TrackPromoEventsDto) {
    return this.promotionsService.trackEvents(dto);
  }
}
