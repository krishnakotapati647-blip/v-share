import { z } from "zod";

// ===================================
// Transfer Code Format
// ===================================
export const TRANSFER_CODE_PREFIX = "VL";
export const TRANSFER_CODE_SEGMENT_LENGTH = 4;
export const TRANSFER_CODE_SEGMENTS = 2;

// Regex: VL-XXXX-XXXX (case-insensitive alphanumeric)
export const TRANSFER_CODE_REGEX = /^VL-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

export function normalizeTransferCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function formatTransferCode(code: string): string {
  const normalized = normalizeTransferCode(code);
  // If already formatted, return as-is
  if (TRANSFER_CODE_REGEX.test(normalized)) return normalized;
  // Try to auto-format from raw characters
  const chars = normalized.replace(/[^A-Z0-9]/gi, "");
  if (chars.length >= 8) {
    return `VL-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  }
  return normalized;
}

// ===================================
// File Validation
// ===================================
export const ALLOWED_VIDEO_MIMETYPES = [
  "video/mp4",
  "video/quicktime",    // .mov
  "video/x-matroska",   // .mkv
  "video/webm",
  "video/x-msvideo",    // .avi
  "video/x-ms-wmv",     // .wmv
  "video/mpeg",
  "video/3gpp",
  "video/x-flv",
] as const;

export const ALLOWED_EXTENSIONS = [
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpeg", ".mpg", ".3gp", ".flv",
] as const;

export const MAX_FILE_SIZE_BYTES = parseInt(
  process.env.MAX_FILE_SIZE_BYTES || "53687091200", // 50 GB for P2P
  10
);

export const UPLOAD_PART_SIZE = parseInt(
  process.env.MAX_UPLOAD_PART_SIZE_BYTES || "4194304", // 4 MB (Vercel serverless payload safe)
  10
);

export const MAX_CONCURRENT_UPLOADS = 4;

// ===================================
// Expiration Presets
// ===================================
export const EXPIRATION_PRESETS = [
  { label: "1 hour", value: 1, unit: "hours" as const },
  { label: "24 hours", value: 24, unit: "hours" as const },
  { label: "7 days", value: 168, unit: "hours" as const },
] as const;

// ===================================
// Zod Schemas
// ===================================
export const createTransferSchema = z.object({
  originalFilename: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  contentType: z.string().min(1),
  expirationHours: z.number().int().min(1).max(168),
  password: z.string().max(128).optional(),
  downloadLimit: z.number().int().min(1).max(1000).optional(),
  senderMessage: z.string().max(500).optional(),
  allowPreview: z.boolean().default(true),
  allowOriginalDownload: z.boolean().default(true),
  checksumAlgorithm: z.literal("SHA-256").default("SHA-256"),
  isP2P: z.boolean().default(true),
  transferMode: z.enum(["p2p", "cloud"]).default("p2p"),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const lookupTransferSchema = z.object({
  code: z.string().min(1).max(20),
  password: z.string().max(128).optional(),
});

export type LookupTransferInput = z.infer<typeof lookupTransferSchema>;

// ===================================
// Upload Session Types
// ===================================
export interface UploadPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface UploadSessionInfo {
  sessionId: string;
  transferId: string;
  uploadId: string; // S3/R2 multipart upload ID
  objectKey: string;
  totalParts: number;
  partSize: number;
  uploadedParts: UploadPart[];
}

// ===================================
// Transfer Status
// ===================================
export type UploadStatus =
  | "pending"
  | "uploading"
  | "finalizing"
  | "completed"
  | "failed"
  | "abandoned"
  | "p2p_waiting"
  | "p2p_streaming";
export type IntegrityStatus = "pending" | "verified" | "failed";
export type TransferStatus = "active" | "expired" | "deleted";

// ===================================
// API Response Types
// ===================================
export interface TransferPublicInfo {
  id?: string;
  code: string;
  originalFilename: string;
  fileSize: number;
  contentType: string;
  expiresAt: string;
  createdAt: string;
  senderMessage?: string;
  allowPreview: boolean;
  allowOriginalDownload: boolean;
  integrityStatus: IntegrityStatus;
  checksumAlgorithm?: string;
  checksumValue?: string;
  downloadLimit?: number;
  downloadCount: number;
  passwordRequired: boolean;
  uploadStatus: UploadStatus;
  isP2P?: boolean;
}

export interface TransferCreatedResponse {
  transferId: string;
  code: string;
  session: UploadSessionInfo;
}

export interface PresignedPartUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

// ===================================
// Utility: Human-readable file size
// ===================================
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatFileSize(bytesPerSecond)}/s`;
}
