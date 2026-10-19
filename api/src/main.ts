import "dotenv/config";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  // CP13: Render routes traffic through a proxy — trust that one hop so the
  // rate-limit key (req.ip) is the real client instead of the proxy address,
  // which would otherwise put every visitor in a single shared bucket.
  const expressInstance = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: number) => void;
  };
  expressInstance.set("trust proxy", 1);

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
