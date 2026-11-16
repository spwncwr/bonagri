import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth.service";

// HP3 (plan G3): dangerous admin mutations additionally require a
// password-confirmed step-up token in the X-Step-Up header (issued by
// POST /auth/step-up, 5-minute TTL). Runs AFTER JwtAuthGuard + RolesGuard, so
// the actor is already a signed-in admin; this guard only answers "did they
// just re-prove their password?". Full token validation lives in
// AuthService.verifyStepUpToken (one place for the derived secret). Failures
// are 403 with a machine-readable code so the web opens the re-auth modal
// instead of guessing.
type StepUpRequest = Request & {
  user?: { id?: string };
  headers: Record<string, string | string[] | undefined>;
};

function stepUpRequired(message: string): ForbiddenException {
  return new ForbiddenException({
    message,
    error: "Forbidden",
    statusCode: 403,
    code: "STEP_UP_REQUIRED",
  });
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<StepUpRequest>();
    const header = request.headers["x-step-up"];
    const token = typeof header === "string" ? header : undefined;

    const actor = await this.authService.verifyStepUpToken(token);

    if (!actor) {
      throw stepUpRequired(
        token
          ? "Step-up confirmation is invalid or expired — confirm your password again"
          : "Step-up confirmation required",
      );
    }

    // The confirmation must belong to the actor making the request.
    if (request.user?.id && actor.id !== request.user.id) {
      throw stepUpRequired(
        "Step-up confirmation belongs to a different account",
      );
    }

    return true;
  }
}
