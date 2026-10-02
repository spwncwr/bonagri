import { Module } from "@nestjs/common";
import { CatalogModule } from "./catalog/catalog.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { OrdersModule } from "./orders/orders.module";

@Module({
  imports: [PrismaModule, HealthModule, CatalogModule, OrdersModule],
})
export class AppModule {}
