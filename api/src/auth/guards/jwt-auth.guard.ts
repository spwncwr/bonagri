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

      request.user = await this.authService.validateUser(payload.sub);

      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
