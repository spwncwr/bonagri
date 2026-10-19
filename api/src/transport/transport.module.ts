import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TransportController } from "./transport.controller";
import { TransportService } from "./transport.service";

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [TransportController],
  providers: [TransportService],
})
export class TransportModule {}
