import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { MediaModule } from "../media/media.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminVerificationController } from "./admin-verification.controller";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";

// CP17: one centralised verification module — buyer OTP, business
// applications, private document access and the admin review centre.
// Marketplace gating (cart/catalog/orders) uses the pure helpers in
// verification.permissions.ts and needs no DI wiring.
@Module({
  imports: [AuthModule, MediaModule, MailModule, NotificationsModule],
  controllers: [VerificationController, AdminVerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
