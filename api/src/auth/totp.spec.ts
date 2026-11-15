import {
  base32Decode,
  buildOtpauthUri,
  generateBase32Secret,
  generateTotp,
  verifyTotp,
} from "./totp";

// RFC 6238 appendix B vectors (HMAC-SHA1). The RFC quotes 8-digit codes;
// the low 6 digits of each vector are exactly what a 6-digit TOTP must
// produce (modulo10^6 is a suffix of modulo10^8).
// Secret is the ASCII "12345678901234567890" in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const RFC_VECTORS: Array<[seconds: number, expected6: string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("totp (RFC 6238)", () => {
  it("matches every RFC test vector", () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
    }
  });

  it("accepts the current code and ±1 step of drift, rejects ±2", () => {
    const now = 1700000000000;
    const stepMs = 30_000;

    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - stepMs), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now + stepMs), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 2 * stepMs), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now + 2 * stepMs), now)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const now = 1700000000000;
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56".replace(/ /g, "") + "x"]) {
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
    }
    // wrong-length and non-digit codes are refused before any HMAC work
    expect(verifyTotp(RFC_SECRET, "123456", now + 2 * 30_000)).toBe(false);
  });

  it("generates 32-char base32 secrets that round-trip", () => {
    const secret = generateBase32Secret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    // the decoder must recover 20 bytes (160-bit HMAC key)
    expect(base32Decode(secret)).toHaveLength(20);
    // self-consistency: a freshly generated secret verifies its own code
    expect(verifyTotp(secret, generateTotp(secret))).toBe(true);
  });

  it("builds a scannable otpauth URI with the pinned parameters", () => {
    const uri = buildOtpauthUri(RFC_SECRET, "admin@bonagri.co.za");
    expect(uri).toMatch(/^otpauth:\/\/totp\/BonAgri:admin%40bonagri\.co\.za\?/);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
