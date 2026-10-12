import "dotenv/config";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import * as nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private readonly transporter: nodemailer.Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;

    if (!host || !user || !password) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass: password,
      },
    });
  }

  async sendVerificationEmail(
    email: string,
    firstName: string,
    verificationUrl: string,
  ) {
    if (
      process.env.E2E_CAPTURE_MAIL === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const captureFile =
        process.env.E2E_MAIL_CAPTURE_FILE ??
        ".e2e/verification-url.txt";

      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");

      await mkdir(dirname(captureFile), { recursive: true });
      await writeFile(captureFile, verificationUrl, "utf8");
    }


    if (!this.transporter) {
      throw new ServiceUnavailableException(
        "Email delivery is not configured",
      );
    }

    const from =
      process.env.SMTP_FROM ??
      process.env.SMTP_USER;

    try {
      await this.transporter.sendMail({
      from,
      to: email,
      subject: "Verify your BonAgri email address",
      text: [
        `Hello ${firstName},`,
        "",
        "Welcome to BonAgri.",
        "",
        "Please verify your email address to activate your BonAgri account:",
        verificationUrl,
        "",
        "This verification link expires in 24 hours.",
        "",
        "If you did not create this account, you can ignore this email.",
        "",
        "BonAgri",
        "Agricultural trade, connected.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">
          <h2>Verify your BonAgri email address</h2>
          <p>Hello ${firstName},</p>
          <p>Welcome to BonAgri.</p>
          <p>
            Please verify your email address to activate your BonAgri account.
          </p>
          <p>
            <a
              href="${verificationUrl}"
              style="display:inline-block;padding:12px 20px;background:#047857;color:#fff;text-decoration:none;border-radius:6px"
            >
              Verify my email
            </a>
          </p>
          <p>This verification link expires in 24 hours.</p>
          <p>
            If you did not create this account, you can ignore this email.
          </p>
          <p>BonAgri<br />Agricultural trade, connected.</p>
        </div>
      `,
      });
    } catch (error) {
      console.error("BonAgri SMTP delivery error:", error);
      throw error;
    }
  }
}
