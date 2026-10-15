import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// ===== Storage Mode Detection =====
function isMockMode(): boolean {
  if (process.env.STORAGE_MODE === "mock") return true;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId || accountId.startsWith("demo-") || accountId === "your-cloudflare-account-id") {
    return true;
  }
  return false;
}

const STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");
const CHUNKS_ROOT = path.join(process.cwd(), ".data", "chunks");

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

// ===== Real S3/R2 Client =====
function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

let r2Client: S3Client | null = null;

export function getClient(): S3Client {
  if (!r2Client) {
    r2Client = getR2Client();
  }
  return r2Client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME not configured");
  return bucket;
}

// ===== Object Key Generation =====
export function generateObjectKey(transferId: string, filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return `uploads/${transferId}/${randomSuffix}_${sanitized}`;
}

// ===== Multipart Upload Operations =====
export async function createMultipartUpload(
  objectKey: string,
  contentType: string
): Promise<string> {
  if (isMockMode()) {
    const uploadId = `mock_up_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const uploadDir = path.join(CHUNKS_ROOT, uploadId);
    ensureDir(uploadDir);
    fs.writeFileSync(path.join(uploadDir, "meta.json"), JSON.stringify({ objectKey, contentType }), "utf8");
    return uploadId;
  }

  const client = getClient();
  const command = new CreateMultipartUploadCommand({
    Bucket: getBucket(),
    Key: objectKey,
    ContentType: contentType,
  });
  const result = await client.send(command);
  if (!result.UploadId) throw new Error("Failed to create multipart upload");
  return result.UploadId;
}

export async function getPresignedUploadUrl(
  objectKey: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  if (isMockMode()) {
    return `${getAppUrl()}/api/mock-storage/upload?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}&key=${encodeURIComponent(objectKey)}`;
  }

  const client = getClient();
  const command = new UploadPartCommand({
    Bucket: getBucket(),
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

export async function completeMultipartUpload(
  objectKey: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<void> {
  if (isMockMode()) {
    const uploadDir = path.join(CHUNKS_ROOT, uploadId);
    const targetFilePath = path.join(STORAGE_ROOT, objectKey);
    ensureDir(path.dirname(targetFilePath));

    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const writeStream = fs.createWriteStream(targetFilePath);

    for (const part of sortedParts) {
      const partPath = path.join(uploadDir, `part_${part.partNumber}`);
      if (fs.existsSync(partPath)) {
        const chunkData = fs.readFileSync(partPath);
        writeStream.write(chunkData);
      }
    }
    writeStream.end();

    // Wait for file write to complete
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", () => resolve());
      writeStream.on("error", (err) => reject(err));
    });

    // Cleanup chunks directory
    try {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    } catch {}
    return;
  }

  const client = getClient();
  const command = new CompleteMultipartUploadCommand({
    Bucket: getBucket(),
    Key: objectKey,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag,
      })),
    },
  });
  await client.send(command);
}

export async function abortMultipartUpload(
  objectKey: string,
  uploadId: string
): Promise<void> {
  if (isMockMode()) {
    const uploadDir = path.join(CHUNKS_ROOT, uploadId);
    try {
      if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      }
    } catch {}
    return;
  }

  try {
    const client = getClient();
    const command = new AbortMultipartUploadCommand({
      Bucket: getBucket(),
      Key: objectKey,
      UploadId: uploadId,
    });
    await client.send(command);
  } catch (error) {
    console.error("Failed to abort multipart upload:", error);
  }
}

// ===== Presigned Download URL =====
export async function getPresignedDownloadUrl(
  objectKey: string,
  filename: string,
  expiresIn: number = 300
): Promise<string> {
  if (isMockMode()) {
    return `${getAppUrl()}/api/mock-storage/download?key=${encodeURIComponent(objectKey)}&filename=${encodeURIComponent(filename)}`;
  }

  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  return getSignedUrl(client, command, { expiresIn });
}

// ===== Presigned Preview URL =====
export async function getPresignedPreviewUrl(
  objectKey: string,
  contentType: string,
  expiresIn: number = 300
): Promise<string> {
  if (isMockMode()) {
    return `${getAppUrl()}/api/mock-storage/preview?key=${encodeURIComponent(objectKey)}`;
  }

  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: "inline",
  });
  return getSignedUrl(client, command, { expiresIn });
}

// ===== Head Object =====
export async function headObject(objectKey: string): Promise<{
  contentLength: number;
  contentType: string;
  etag: string;
}> {
  if (isMockMode()) {
    const filePath = path.join(STORAGE_ROOT, objectKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Object not found: ${objectKey}`);
    }
    const stat = fs.statSync(filePath);
    return {
      contentLength: stat.size,
      contentType: "video/mp4",
      etag: `"${stat.mtimeMs}"`,
    };
  }

  const client = getClient();
  const command = new HeadObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
  });
  const result = await client.send(command);
  return {
    contentLength: result.ContentLength ?? 0,
    contentType: result.ContentType ?? "application/octet-stream",
    etag: result.ETag ?? "",
  };
}

// ===== Delete Object =====
export async function deleteObject(objectKey: string): Promise<void> {
  if (isMockMode()) {
    const filePath = path.join(STORAGE_ROOT, objectKey);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
    return;
  }

  try {
    const client = getClient();
    const command = new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: objectKey,
    });
    await client.send(command);
  } catch (error) {
    console.error("Failed to delete object:", error);
    throw error;
  }
}

// ===== Cleanup Abandoned Uploads =====
export async function cleanupAbandonedUploads(): Promise<number> {
  if (isMockMode()) {
    let cleaned = 0;
    try {
      if (fs.existsSync(CHUNKS_ROOT)) {
        const dirs = fs.readdirSync(CHUNKS_ROOT);
        const maxAge = 24 * 60 * 60 * 1000;
        const now = Date.now();
        for (const dir of dirs) {
          const dirPath = path.join(CHUNKS_ROOT, dir);
          const stat = fs.statSync(dirPath);
          if (now - stat.mtimeMs > maxAge) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            cleaned++;
          }
        }
      }
    } catch {}
    return cleaned;
  }

  const client = getClient();
  let cleaned = 0;

  try {
    const listCommand = new ListMultipartUploadsCommand({
      Bucket: getBucket(),
    });
    const result = await client.send(listCommand);

    if (!result.Uploads) return 0;

    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const upload of result.Uploads) {
      if (upload.Initiated && now - upload.Initiated.getTime() > maxAge) {
        if (upload.Key && upload.UploadId) {
          await abortMultipartUpload(upload.Key, upload.UploadId);
          cleaned++;
        }
      }
    }
  } catch (error) {
    console.error("Failed to cleanup abandoned uploads:", error);
  }

  return cleaned;
}
