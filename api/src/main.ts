import "dotenv/config";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  // CP13: Render routes traffic through a proxy chain (edge → router →
  // instance); trust both hops so the rate-limit key (req.ip) is the real
  // client instead of a per-request edge IP, which would otherwise put every
  // visitor in a scattered set of buckets and defeat the limiter. Verified
  // empirically in production: with trust=1 the counter never decremented
  // consistently and a 16-attempt login burst never hit 429.
  const expressInstance = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: number) => void;
  };
  expressInstance.set("trust proxy", 2);

  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
