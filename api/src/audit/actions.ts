// HP3 (plan G3): machine names for every guarded admin mutation. One constant
// per guarded route — the web audit filter and the smoke assertions read these
// strings, so they are part of the contract, not free text.

export const AdminAuditAction = {
  USER_STATUS_UPDATE: "USER_STATUS_UPDATE",
  USER_PROMOTE_SUPPLIER: "USER_PROMOTE_SUPPLIER",
  USER_PROMOTE_TRANSPORTER: "USER_PROMOTE_TRANSPORTER",
  SUPPLIER_VERIFY: "SUPPLIER_VERIFY",
  TRANSPORTER_VERIFY: "TRANSPORTER_VERIFY",
  CATEGORY_CREATE: "CATEGORY_CREATE",
  CATEGORY_UPDATE: "CATEGORY_UPDATE",
  BROADCAST_SEND: "BROADCAST_SEND",
  BANNER_CREATE: "BANNER_CREATE",
  BANNER_UPDATE: "BANNER_UPDATE",
  BANNER_DELETE: "BANNER_DELETE",
  PROMOTION_CREATE: "PROMOTION_CREATE",
  PROMOTION_UPDATE: "PROMOTION_UPDATE",
  PROMOTION_PUBLISH: "PROMOTION_PUBLISH",
  PROMOTION_PAUSE: "PROMOTION_PAUSE",
  PROMOTION_RESUME: "PROMOTION_RESUME",
  PROMOTION_DELETE: "PROMOTION_DELETE",
} as const;

export type AdminAuditActionName =
  (typeof AdminAuditAction)[keyof typeof AdminAuditAction];

// targetType values — coarse entity class so the table can render a stable
// label without parsing metadata.
export type AdminAuditTargetType =
  | "USER"
  | "SUPPLIER_PROFILE"
  | "TRANSPORTER_PROFILE"
  | "CATEGORY"
  | "BROADCAST"
  | "BANNER"
  | "PROMOTION";
