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
    use: (
      handler: (
        req: {
          ip?: string;
          headers: Record<string, string | string[] | undefined>;
        },
        res: { setHeader: (name: string, value: string) => void },
        next: () => void,
      ) => void,
    ) => void;
  };
  expressInstance.set("trust proxy", 2);

  // TEMPORARY (CP13 diagnosis): echo how the server sees the client so the
  // trust-proxy depth can be chosen from evidence, not guesses.
  expressInstance.use((req, res, next) => {
    res.setHeader("X-Debug-Client-Ip", req.ip ?? "none");
    res.setHeader(
      "X-Debug-Xff",
      String(req.headers["x-forwarded-for"] ?? "none"),
    );
    res.setHeader(
      "X-Debug-X-Real-Ip",
      String(req.headers["x-real-ip"] ?? "none"),
    );
    next();
  });

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
