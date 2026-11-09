import { ServiceUnavailableException } from "@nestjs/common";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailService } from "./mail.service";

/*
 * E2E capture mode must never reach real SMTP: the runtime smoke runs with
 * E2E_CAPTURE_MAIL=true and no reachable mail provider. Verification mail
 * historically skipped the capture and blew up registration with a 500.
 */
describe("MailService capture mode", () => {
  const originalEnv = {
    E2E_CAPTURE_MAIL: process.env.E2E_CAPTURE_MAIL,
    E2E_MAIL_CAPTURE_FILE: process.env.E2E_MAIL_CAPTURE_FILE,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };

  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "bonagri-mail-spec-"));
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  function captureEnabledService(captureFile: string): MailService {
    process.env.E2E_CAPTURE_MAIL = "true";
    process.env.E2E_MAIL_CAPTURE_FILE = captureFile;
    // No SMTP credentials: without the capture short-circuit the send path
    // hits `if (!this.transporter) throw` and the caller sees a 500.
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    return new MailService();
  }

  it("captures the verification URL and never touches SMTP", async () => {
    const captureFile = join(tempDir, "verification-url.txt");
    const service = captureEnabledService(captureFile);
    const verificationUrl =
      "http://localhost:3001/verify-email?token=e2e-token-123";

    await expect(
      service.sendVerificationEmail(
        "e2e_buyer@bonagri.local",
        "E2E",
        verificationUrl,
      ),
    ).resolves.toBeUndefined();

    await expect(readFile(captureFile, "utf8")).resolves.toBe(
      verificationUrl,
    );
  });

  it("still rejects the send when capture mode is off and SMTP is missing", async () => {
    delete process.env.E2E_CAPTURE_MAIL;
    const service = new MailService();

    await expect(
      service.sendVerificationEmail(
        "e2e_buyer@bonagri.local",
        "E2E",
        "http://localhost:3001/verify-email?token=x",
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
