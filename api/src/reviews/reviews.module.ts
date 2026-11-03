import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({
  imports: [AuthModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  // Catalog injects the service to attach rating summaries to products.
  exports: [ReviewsService],
})
export class ReviewsModule {}
