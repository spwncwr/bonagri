-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliverySnapshot" JSONB;

-- Backfill: freeze today's address content for orders placed before the
-- snapshot existed (the original at-placement content is not recoverable —
-- edits already overwrote the live row). Shape matches
-- api/src/common/delivery-snapshot.ts buildDeliverySnapshot():
-- text fields + both-or-neither normalized lat/lng + ISO-8601 UTC stamp.
UPDATE "Order" o
SET "deliverySnapshot" = jsonb_build_object(
  'addressId', a."id",
  'label', a."label",
  'recipientName', a."recipientName",
  'phone', a."phone",
  'addressLine1', a."addressLine1",
  'addressLine2', a."addressLine2",
  'city', a."city",
  'province', a."province",
  'postalCode', a."postalCode",
  'country', a."country",
  'lat',
    CASE
      WHEN a."lat" IS NOT NULL AND a."lng" IS NOT NULL
       AND a."lat" BETWEEN -90 AND 90
       AND a."lng" BETWEEN -180 AND 180
      THEN a."lat"
      ELSE NULL
    END,
  'lng',
    CASE
      WHEN a."lat" IS NOT NULL AND a."lng" IS NOT NULL
       AND a."lat" BETWEEN -90 AND 90
       AND a."lng" BETWEEN -180 AND 180
      THEN a."lng"
      ELSE NULL
    END,
  'snapshottedAt', to_char(a."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM "Address" a
WHERE o."deliveryAddressId" = a."id"
  AND o."deliverySnapshot" IS NULL;
