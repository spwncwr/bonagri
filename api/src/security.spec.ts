import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { applySecurity, resolveCorsOrigins } from "./security";

// HP6 (plan G6): pin the exact CORS + helmet wiring main.ts serves. The
// e2e suite boots AppModule without main.ts, so this spec builds a bare
// application and applies the same helper — no database required.

@Controller("probe")
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }
}

const ALLOWED_ORIGIN = "http://localhost:3001";
const FOREIGN_ORIGIN = "https://evil.example";

describe("security wiring (HP6)", () => {
  describe("resolveCorsOrigins", () => {
    it("falls back to the local dev web origin when nothing is configured", () => {
      expect(resolveCorsOrigins({})).toEqual(["http://localhost:3001"]);
    });

    it("unions CORS_ORIGIN and WEB_BASE_URL, deduped and trimmed", () => {
      expect(
        resolveCorsOrigins({
          CORS_ORIGIN: "http://localhost:3001, https://app.example",
          WEB_BASE_URL: "http://localhost:3001 , https://admin.example",
        }),
      ).toEqual([
        "http://localhost:3001",
        "https://app.example",
        "https://admin.example",
      ]);
    });

    it("drops empty entries", () => {
      expect(
        resolveCorsOrigins({ CORS_ORIGIN: " ,  ,,https://only.example ,", WEB_BASE_URL: "" }),
      ).toEqual(["https://only.example"]);
    });
  });

  describe("applySecurity", () => {
    let app: INestApplication;
    const originalCorsOrigin = process.env.CORS_ORIGIN;
    const originalWebBaseUrl = process.env.WEB_BASE_URL;

    beforeAll(async () => {
      // Pin the allowlist deterministically — api/.env may leak into this
      // process via another spec importing dotenv.
      process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
      process.env.WEB_BASE_URL = ALLOWED_ORIGIN;

      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();

      app = moduleRef.createNestApplication();
      app.setGlobalPrefix("api");
      applySecurity(app);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
      if (originalCorsOrigin === undefined) {
        delete process.env.CORS_ORIGIN;
      } else {
        process.env.CORS_ORIGIN = originalCorsOrigin;
      }
      if (originalWebBaseUrl === undefined) {
        delete process.env.WEB_BASE_URL;
      } else {
        process.env.WEB_BASE_URL = originalWebBaseUrl;
      }
    });

    it("serves the helmet header set (and no X-Powered-By)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/probe")
        .expect(200);

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers["strict-transport-security"]).toBe(
        "max-age=15552000",
      );
      expect(res.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(res.headers["content-security-policy"]).toContain(
        "script-src 'none'",
      );
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    it("echoes an allowlisted origin with credentials", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/probe")
        .set("Origin", ALLOWED_ORIGIN)
        .expect(200);

      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("rejects a foreign origin: no ACAO on the response", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/probe")
        .set("Origin", FOREIGN_ORIGIN)
        .expect(200);

      // The cors package still emits Access-Control-Allow-Credentials for a
      // disallowed origin — harmless: without an echoed Allow-Origin the
      // browser refuses to expose the response either way.
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("rejects a foreign-origin preflight: no ACAO in the answer", async () => {
      const res = await request(app.getHttpServer())
        .options("/api/probe")
        .set("Origin", FOREIGN_ORIGIN)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "authorization");

      expect([200, 204]).toContain(res.status);
      // Same story as above: allow-headers/methods may be echoed, but the
      // missing Allow-Origin fails the preflight and the browser never
      // sends the real request.
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("answers an allowlisted preflight", async () => {
      const res = await request(app.getHttpServer())
        .options("/api/probe")
        .set("Origin", ALLOWED_ORIGIN)
        .set("Access-Control-Request-Method", "GET")
        .expect(204);

      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
    });
  });
});
