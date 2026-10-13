import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailModule } from "../mail/mail.module";
import { DisputesController } from "./disputes.controller";
import { DisputesService } from "./disputes.service";

@Module({
  imports: [AuthModule, MailModule],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
