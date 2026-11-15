import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { AuthService } from "../auth.service";

type JwtPayload = {
  sub: string;
  type?: string;
};

type AuthenticatedRequest = Request & {
  user: unknown;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer token required");
    }

    const token = authorization.slice(7);

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // HP2: pre-auth tokens are signed with a derived secret so they fail
      // verification here already; this explicit check is defence in depth
      // against ever signing one with the main secret.
      if (payload.type === "pre-auth") {
        throw new Error("pre-auth token presented as access token");
      }

      request.user = await this.authService.validateUser(payload.sub);

      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
