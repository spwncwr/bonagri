import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MediaModule } from "../media/media.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [AuthModule, MediaModule, ReviewsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
