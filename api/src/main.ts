import "dotenv/config";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");

  // CP13: Render serves traffic through a fixed 3-hop chain
  //   client → Cloudflare edge → Render router → instance
  // so each hop appends one X-Forwarded-For entry. Express resolves
  // req.ip = XFF[len - N] for `trust proxy: N`:
  //   N=1 → Render's internal 10.x address (varies per request),
  //   N=2 → the Cloudflare edge IP (varies per request!),
  //   N=3 → the real client IP (stable).
  // N must be exactly 3: with N=1/2 every request lands in its own
  // rate-limit bucket (verified in production — a 16-attempt login burst
  // never hit 429), and N>3 would let a client prepend fake X-Forwarded-For
  // entries to rotate buckets and bypass the limiter entirely.
  const expressInstance = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: number) => void;
  };
  expressInstance.set("trust proxy", 3);

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
