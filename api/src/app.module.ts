import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { CatalogModule } from "./catalog/catalog.module";
import { DisputesModule } from "./disputes/disputes.module";
import { HealthModule } from "./health/health.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { OrdersModule } from "./orders/orders.module";
import { AddressesModule } from "./addresses/addresses.module";
import { RequestsModule } from "./requests/requests.module";
import { SellerApplicationsModule } from "./seller-applications/seller-applications.module";
import { CartModule } from "./cart/cart.module";
import { TransportModule } from "./transport/transport.module";
import { CheckpointsModule } from "./checkpoints/checkpoints.module";
import { MediaModule } from "./media/media.module";

@Module({
  imports: [
    // CP13: base rate-limit budget (120/min per client IP) for the routes
    // that opt in with ThrottlerGuard (auth/*, public catalog + request
    // board reads). Health is intentionally unthrottled for monitors.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      errorMessage: "Too many requests — please slow down and try again shortly",
      setHeaders: true,
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    CatalogModule,
    OrdersModule,
    AddressesModule,
    AdminModule,
    DisputesModule,
    NotificationsModule,
    RequestsModule,
    SellerApplicationsModule,
    CartModule,
    TransportModule,
    CheckpointsModule,
    MediaModule,
  ],
})
export class AppModule {}
