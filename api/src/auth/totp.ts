import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// HP2: dependency-free TOTP (RFC 6238, HMAC-SHA1, 30s, 6 digits) — the
// algorithm is small enough that a package would add more risk than it
// removes. Correctness is pinned by the RFC 6238 test vectors in
// totp.spec.ts; verifyTotp uses a ±1 step window for clock drift.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

// RFC 4648 base32 (no padding),20 random bytes = 32 chars.
export function generateBase32Secret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character in TOTP secret");
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  const code = truncated % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

export function generateTotp(secret: string, atMs: number = Date.now()): string {
  const counter = BigInt(Math.floor(atMs / 1000 / PERIOD_SECONDS));
  return hotp(secret, counter);
}

// Accepts the current step plus/minus one (30–90s of drift). Comparison is
// timing-safe on equal-length buffers.
export function verifyTotp(
  secret: string,
  code: string,
  atMs: number = Date.now(),
): boolean {
  const candidate = code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(candidate)) {
    return false;
  }

  const counter = BigInt(Math.floor(atMs / 1000 / PERIOD_SECONDS));

  for (const step of [counter - 1n, counter, counter + 1n]) {
    if (step < 0n) continue;
    const expected = hotp(secret, step);
    if (
      timingSafeEqual(Buffer.from(expected), Buffer.from(candidate)) &&
      expected === candidate
    ) {
      return true;
    }
  }

  return false;
}

// What the authenticator app scans: otpauth://totp/<issuer>:<account>?…
export function buildOtpauthUri(secret: string, accountLabel: string): string {
  const issuer = "BonAgri";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
