import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { UserRole } from "../common/types";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifiedAt: true,
      },
    });

    if (existingUser) {
      throw new ConflictException(
        "An account with this email already exists",
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim(),
        role: "BUYER",
        emailVerificationTokens: {
          create: {
            tokenHash,
            expiresAt,
          },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
      },
    });

    const webBaseUrl =
      process.env.WEB_BASE_URL ?? "http://localhost:3001";

    const verificationUrl =
      `${webBaseUrl}/verify-email?token=${verificationToken}`;

    try {
      await this.mailService.sendVerificationEmail(
        user.email,
        user.firstName,
        verificationUrl,
      );
    } catch (error) {
      await this.prisma.user.delete({
        where: { id: user.id },
      });

      throw error;
    }

    return {
      message:
        "Account created. Please check your email to verify your account.",
      emailVerificationRequired: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    };
  }

  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);

    const verificationToken =
      await this.prisma.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              status: true,
              emailVerifiedAt: true,
            },
          },
        },
      });

    if (!verificationToken) {
      throw new UnauthorizedException(
        "Invalid or expired verification link",
      );
    }

    if (
      verificationToken.usedAt ||
      verificationToken.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        "Invalid or expired verification link",
      );
    }

    if (verificationToken.user.emailVerifiedAt) {
      return {
        message: "Email address is already verified.",
        emailVerified: true,
      };
    }

    const verifiedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: verificationToken.user.id },
        data: {
          emailVerifiedAt: verifiedAt,
        },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: verificationToken.id },
        data: {
          usedAt: verifiedAt,
        },
      }),
    ]);

    return {
      message: "Email address verified successfully.",
      emailVerified: true,
    };
  }

  async resendVerificationEmail(emailInput: string) {
    const email = emailInput.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        emailVerifiedAt: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        "Unable to resend verification email",
      );
    }

    if (user.emailVerifiedAt) {
      return {
        message: "Email address is already verified.",
        emailVerified: true,
      };
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException(
        "User account is not active",
      );
    }

    await this.prisma.emailVerificationToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    const verificationToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(verificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const webBaseUrl =
      process.env.WEB_BASE_URL ?? "http://localhost:3001";

    const verificationUrl =
      `${webBaseUrl}/verify-email?token=${verificationToken}`;

    await this.mailService.sendVerificationEmail(
      user.email,
      user.firstName,
      verificationUrl,
    );

    return {
      message: "A new verification email has been sent.",
      emailVerificationRequired: true,
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Please verify your email address before signing in",
      );
    }

    return this.issueToken(user);
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is not active");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Email address has not been verified",
      );
    }

    return user;
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async issueToken(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: UserRole;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
    emailVerifiedAt: Date | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  }
}
