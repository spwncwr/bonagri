import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminAuditService } from "./admin-audit.service";
import { AuditController } from "./audit.controller";

// HP3: the admin audit trail. PrismaModule is global, so only the service and
// the read controller live here; AdminModule and PromotionsModule import the
// service to wrap their guarded mutations. AuthModule backs the controller's
// JwtAuthGuard/RolesGuard (its JwtModule provides JwtService at runtime —
// type-checking alone cannot catch a missing module import).
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AuditModule {}
