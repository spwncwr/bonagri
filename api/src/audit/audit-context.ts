import type { Request } from "express";

// HP3: what every guarded mutation needs to write its audit row — who did it
// and from where. Built once in the controller from the authenticated request
// (ip/user-agent are metadata only; the actor id comes from the verified JWT).
export type AuditContext = {
  actorUserId: string;
  ip?: string;
  userAgent?: string;
};

type AuditableRequest = Request & {
  user: { id: string };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

export function auditContextFrom(request: AuditableRequest): AuditContext {
  const rawAgent = request.headers["user-agent"];
  const userAgent = Array.isArray(rawAgent)
    ? rawAgent[0]
    : rawAgent;

  return {
    actorUserId: request.user.id,
    ip: request.ip,
    userAgent,
  };
}
