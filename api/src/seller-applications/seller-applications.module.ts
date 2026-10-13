import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SellerApplicationsController } from "./seller-applications.controller";
import { SellerApplicationsService } from "./seller-applications.service";

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [SellerApplicationsController],
  providers: [SellerApplicationsService],
})
export class SellerApplicationsModule {}
