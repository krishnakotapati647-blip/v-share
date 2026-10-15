import { NextRequest, NextResponse } from "next/server";
import {
  createTransferSchema,
  UPLOAD_PART_SIZE,
} from "@/lib/types";
import {
  generateTransferCode,
  hashTransferCode,
  hashPassword,
  checkRateLimit,
  sanitizeFilename,
} from "@/lib/security";
import {
  createMultipartUpload,
  generateObjectKey,
} from "@/lib/storage";
import {
  createTransfer,
  createUploadSession,
  createTransferEvent,
} from "@/lib/dal";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = checkRateLimit(`transfer_create_${ip}`, 20, 3600_000); // 20 per hour
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many transfer creations. Please try again later." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parsed = createTransferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const sanitizedFilename = sanitizeFilename(data.originalFilename);

    // Generate secure transfer code (VL-XXXX-XXXX)
    const displayCode = generateTransferCode();
    const codeLookupHash = hashTransferCode(displayCode);

    // Calculate expiration
    const expiresAt = new Date(Date.now() + data.expirationHours * 3600 * 1000);

    // Optional password hash
    let passwordHash: string | undefined;
    if (data.password && data.password.trim()) {
      passwordHash = await hashPassword(data.password.trim());
    }

    // Temporary ID for key generation
    const tempTransferId = `tr_${Date.now()}`;
    const objectKey = generateObjectKey(tempTransferId, sanitizedFilename);

    // Initiate multipart upload in storage (R2 or mock)
    const storageUploadId = await createMultipartUpload(objectKey, data.contentType);

    // Create Transfer record
    const transfer = await createTransfer({
      codeLookupHash,
      displayCode,
      originalFilename: sanitizedFilename,
      objectKey,
      fileSize: data.fileSize,
      contentType: data.contentType,
      checksumAlgorithm: data.checksumAlgorithm,
      integrityStatus: "pending",
      uploadStatus: "uploading",
      passwordHash,
      senderMessage: data.senderMessage,
      allowPreview: data.allowPreview,
      allowOriginalDownload: data.allowOriginalDownload,
      downloadLimit: data.downloadLimit,
      expiresAt,
    });

    const totalParts = Math.ceil(data.fileSize / UPLOAD_PART_SIZE);

    // Create UploadSession record
    const session = await createUploadSession({
      transferId: transfer.id,
      storageUploadId,
      objectKey,
      totalParts,
      partSize: UPLOAD_PART_SIZE,
    });

    // Audit event
    await createTransferEvent(transfer.id, "upload_initiated", {
      originalFilename: sanitizedFilename,
      fileSize: data.fileSize,
      totalParts,
    });

    return NextResponse.json(
      {
        transferId: transfer.id,
        code: displayCode,
        session: {
          sessionId: session.id,
          transferId: transfer.id,
          uploadId: storageUploadId,
          objectKey,
          totalParts,
          partSize: UPLOAD_PART_SIZE,
          uploadedParts: [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create transfer error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
