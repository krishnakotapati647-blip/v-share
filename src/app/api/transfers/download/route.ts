import { NextRequest, NextResponse } from "next/server";
import { normalizeTransferCode } from "@/lib/types";
import {
  hashTransferCode,
  verifyPassword,
  checkRateLimit,
} from "@/lib/security";
import {
  getTransferByCodeHash,
  incrementDownloadCount,
  createTransferEvent,
} from "@/lib/dal";
import { getPresignedDownloadUrl } from "@/lib/storage";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = checkRateLimit(`download_${ip}`, 30, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many download requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { code, password } = body as { code?: string; password?: string };

    if (!code) {
      return NextResponse.json({ error: "Transfer code is required" }, { status: 400 });
    }

    const normalized = normalizeTransferCode(code);
    const lookupHash = hashTransferCode(normalized);

    const transfer = await getTransferByCodeHash(lookupHash);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    // Expiration
    if (new Date() > new Date(transfer.expiresAt)) {
      return NextResponse.json({ error: "Transfer has expired" }, { status: 410 });
    }

    // Upload status
    if (transfer.uploadStatus !== "completed") {
      return NextResponse.json({ error: "Transfer upload is incomplete" }, { status: 400 });
    }

    // Allowed original download check
    if (!transfer.allowOriginalDownload) {
      return NextResponse.json(
        { error: "Original file downloads are disabled for this transfer" },
        { status: 403 }
      );
    }

    // Download limit check
    if (transfer.downloadLimit && transfer.downloadCount >= transfer.downloadLimit) {
      return NextResponse.json(
        { error: "Download limit for this transfer has been exceeded" },
        { status: 410 }
      );
    }

    // Password verification
    if (transfer.passwordHash) {
      if (!password) {
        return NextResponse.json({ error: "Password is required" }, { status: 401 });
      }
      const isValid = await verifyPassword(password, transfer.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
      }
    }

    // Increment download count
    await incrementDownloadCount(transfer.id);

    // Audit event
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    await createTransferEvent(transfer.id, "download_authorized", {}, ipHash);

    // Generate presigned download URL with original filename
    const downloadUrl = await getPresignedDownloadUrl(
      transfer.objectKey,
      transfer.originalFilename,
      600 // 10 minutes valid
    );

    return NextResponse.json({
      downloadUrl,
      filename: transfer.originalFilename,
      fileSize: transfer.fileSize,
    });
  } catch (error) {
    console.error("Authorize download error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download authorization failed" },
      { status: 500 }
    );
  }
}
