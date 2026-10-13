import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { CatalogModule } from "./catalog/catalog.module";
import { DisputesModule } from "./disputes/disputes.module";
import { HealthModule } from "./health/health.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { OrdersModule } from "./orders/orders.module";
import { AddressesModule } from "./addresses/addresses.module";
import { SellerApplicationsModule } from "./seller-applications/seller-applications.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HealthModule,
    CatalogModule,
    OrdersModule,
    AddressesModule,
    AdminModule,
    DisputesModule,
    NotificationsModule,
    SellerApplicationsModule,
  ],
})
export class AppModule {}
