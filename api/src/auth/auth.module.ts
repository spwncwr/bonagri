import "dotenv/config";

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { accessTtlSeconds } from "./token-ttl";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { MailModule } from "../mail/mail.module";

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        // HP5: 15-minute access tokens (was 24h). The rotating refresh
        // cookie in auth.service keeps the session alive past that.
        expiresIn: accessTtlSeconds(),
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
