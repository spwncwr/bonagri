import "dotenv/config";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { dirname } from "node:path";
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

      // Capture mode short-circuits: E2E runs must never hit real SMTP.
      return;
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

  // CP17: buyer phone verification. There is no SMS provider in this stack —
  // the code travels over the already-verified account email (the trusted
  // channel we have). 6 digits, 10 minute expiry; the caller stores only the
  // hash. Same E2E capture convention as the other transactional mails.
  async sendPhoneOtpEmail(
    email: string,
    firstName: string,
    code: string,
    phone: string,
  ) {
    if (
      process.env.E2E_CAPTURE_MAIL === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const captureFile =
        process.env.E2E_OTP_CAPTURE_FILE ?? ".e2e/phone-otp.txt";

      const { mkdir, writeFile } = await import("node:fs/promises");

      await mkdir(dirname(captureFile), { recursive: true });
      await writeFile(captureFile, code, "utf8");

      // Capture mode short-circuits: E2E runs must never hit real SMTP.
      return;
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
        subject: "Your BonAgri phone verification code",
        text: [
          `Hello ${firstName},`,
          "",
          `Your BonAgri verification code for ${phone} is:`,
          "",
          code,
          "",
          "It expires in 10 minutes. If you did not request this code,",
          "you can ignore this email — your number stays unverified.",
          "",
          "BonAgri",
          "Agricultural trade, connected.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">
            <h2>Phone verification code</h2>
            <p>Hello ${firstName},</p>
            <p>Your verification code for <strong>${phone}</strong> is:</p>
            <p style="font-size:32px;letter-spacing:8px;font-weight:bold">${code}</p>
            <p>It expires in 10 minutes.</p>
            <p>If you did not request this code, ignore this email — your number stays unverified.</p>
            <p>BonAgri<br />Agricultural trade, connected.</p>
          </div>
        `,
      });
    } catch (error) {
      console.error("BonAgri OTP SMTP delivery error:", error);
      throw error;
    }
  }

  async sendDisputeResolutionEmail(
    email: string,
    firstName: string,
    orderNumber: string,
    outcome: "RESOLVED" | "REJECTED",
    resolutionNote: string | null,
  ) {
    if (
      process.env.E2E_CAPTURE_MAIL === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const captureFile =
        process.env.E2E_DISPUTE_CAPTURE_FILE ??
        ".e2e/dispute-resolution.txt";

      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");

      await mkdir(dirname(captureFile), { recursive: true });
      await writeFile(
        captureFile,
        JSON.stringify({ email, orderNumber, outcome, resolutionNote }),
        "utf8",
      );

      // Capture mode short-circuits: E2E runs must never hit real SMTP.
      return;
    }

    if (!this.transporter) {
      throw new ServiceUnavailableException(
        "Email delivery is not configured",
      );
    }

    const from =
      process.env.SMTP_FROM ??
      process.env.SMTP_USER;

    const resolved = outcome === "RESOLVED";

    const subject = resolved
      ? `BonAgri dispute update: order ${orderNumber} resolved`
      : `BonAgri dispute update: order ${orderNumber} rejected`;

    try {
      await this.transporter.sendMail({
        from,
        to: email,
        subject,
        text: [
          `Hello ${firstName},`,
          "",
          resolved
            ? `Your dispute on order ${orderNumber} has been resolved in your favour.`
            : `Your dispute on order ${orderNumber} has been reviewed and rejected.`,
          "",
          ...(resolutionNote
            ? [`Resolution note: ${resolutionNote}`, ""]
            : []),
          "You can view the full dispute and order timeline in your BonAgri account.",
          "",
          "BonAgri",
          "Agricultural trade, connected.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">
            <h2>${resolved ? "Dispute resolved" : "Dispute rejected"}</h2>
            <p>Hello ${firstName},</p>
            <p>
              ${resolved
                ? `Your dispute on order <strong>${orderNumber}</strong> has been resolved in your favour.`
                : `Your dispute on order <strong>${orderNumber}</strong> has been reviewed and rejected.`}
            </p>
            ${resolutionNote
              ? `<p><strong>Resolution note:</strong> ${resolutionNote}</p>`
              : ""}
            <p>You can view the full dispute and order timeline in your BonAgri account.</p>
            <p>BonAgri<br />Agricultural trade, connected.</p>
          </div>
        `,
      });
    } catch (error) {
      console.error("BonAgri SMTP delivery error:", error);
      throw error;
    }
  }

  async sendNotificationEmail(
    email: string,
    firstName: string,
    title: string,
    message: string,
  ) {
    if (
      process.env.E2E_CAPTURE_MAIL === "true" &&
      process.env.NODE_ENV !== "production"
    ) {
      const captureFile =
        process.env.E2E_NOTIFY_CAPTURE_FILE ??
        ".e2e/notifications.txt";

      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");

      await mkdir(dirname(captureFile), { recursive: true });
      await writeFile(
        captureFile,
        JSON.stringify({ email, firstName, title, message }),
        "utf8",
      );

      // Capture mode short-circuits: E2E runs must never hit real SMTP.
      return;
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
        subject: `BonAgri: ${title}`,
        text: [
          `Hello ${firstName},`,
          "",
          message,
          "",
          "You can view the full details in your BonAgri account.",
          "",
          "BonAgri",
          "Agricultural trade, connected.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto">
            <h2>${title}</h2>
            <p>Hello ${firstName},</p>
            <p>${message}</p>
            <p>You can view the full details in your BonAgri account.</p>
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
