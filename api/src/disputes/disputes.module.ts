import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { DisputesController } from "./disputes.controller";
import { DisputesService } from "./disputes.service";

@Module({
  imports: [AuthModule, MailModule, NotificationsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
