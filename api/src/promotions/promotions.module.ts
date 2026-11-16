import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { MediaModule } from "../media/media.module";
import { AdminPromotionsController } from "./admin-promotions.controller";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";

@Module({
  // HP3: AuditModule provides the guarded() wrapper every mutation below
  // writes its audit row through.
  imports: [AuthModule, AuditModule, MediaModule],
  controllers: [PromotionsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
