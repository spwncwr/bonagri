import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { MailModule } from "../mail/mail.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { VerificationModule } from "../verification/verification.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    AuthModule,
    // HP3: every guarded mutation writes its audit row through this.
    AuditModule,
    MailModule,
    MediaModule,
    NotificationsModule,
    // CP17: the legacy supplier verify toggle syncs through the centralised
    // verification summary so badge and businessStatus cannot diverge.
    VerificationModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
