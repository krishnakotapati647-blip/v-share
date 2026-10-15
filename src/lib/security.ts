import crypto from "crypto";
import bcryptjs from "bcryptjs";

// ===== Transfer Code Generation =====
// Format: VL-XXXX-XXXX (8 alphanumeric characters = ~41 bits entropy)
const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // No 0, 1, I, O to avoid confusion
const CODE_LENGTH = 8; // 4 + 4

export function generateTransferCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return `VL-${code.slice(0, 4)}-${code.slice(4)}`;
}

// ===== Transfer Code Hashing (for DB lookup) =====
// Using HMAC-SHA256 with a secret to prevent rainbow table attacks
export function hashTransferCode(code: string): string {
  const secret = process.env.TRANSFER_CODE_SECRET;
  if (!secret) {
    throw new Error("TRANSFER_CODE_SECRET not configured");
  }
  const normalized = code.trim().toUpperCase();
  return crypto
    .createHmac("sha256", secret)
    .update(normalized)
    .digest("hex");
}

// ===== Password Hashing =====
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcryptjs.compare(password, hash);
}

// ===== Rate Limiting (in-memory, per-process) =====
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000); // Every minute

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return {
    allowed: true,
    remaining: maxRequests - existing.count,
    resetAt: existing.resetAt,
  };
}

// ===== Secure Filename Sanitization =====
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  let safe = filename.replace(/[/\\]/g, "_");
  // Remove null bytes and control characters
  safe = safe.replace(/[\x00-\x1f\x7f]/g, "");
  // Limit length
  safe = safe.slice(0, 255);
  // Ensure it's not empty
  if (!safe || safe === "." || safe === "..") {
    safe = "download";
  }
  return safe;
}

// ===== SHA-256 Hash =====
export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
