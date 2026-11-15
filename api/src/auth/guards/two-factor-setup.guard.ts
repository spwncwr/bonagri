import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth.service";

// HP2: lets /auth/2fa/setup and /auth/2fa/enable through on EITHER token the
// enrolment journey can hold — the password-verified pre-auth token (the
// mandatory first-login redirect) or an already-issued access token (an
// enrolled admin re-keying later). Full validation (signature, purpose,
// stored hash, expiry) happens in AuthService.resolveSetupActor.
type SetupAuthenticatedRequest = Request & {
  user: { id: string; viaPreAuth: boolean };
  headers: { authorization?: string };
};

@Injectable()
export class TwoFactorSetupGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request =
      context.switchToHttp().getRequest<SetupAuthenticatedRequest>();

    request.user = await this.authService.resolveSetupActor(
      request.headers.authorization,
    );

    if (!request.user) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    return true;
  }
}
