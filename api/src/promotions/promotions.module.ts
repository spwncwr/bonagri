import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MediaModule } from "../media/media.module";
import { AdminPromotionsController } from "./admin-promotions.controller";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
