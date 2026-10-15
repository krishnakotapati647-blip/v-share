import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTransferCode,
  type TransferPublicInfo,
} from "@/lib/types";
import {
  hashTransferCode,
  verifyPassword,
  checkRateLimit,
} from "@/lib/security";
import {
  getTransferByCodeHash,
  createTransferEvent,
} from "@/lib/dal";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = checkRateLimit(`code_lookup_${ip}`, 30, 60_000); // 30 per min
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many code lookup attempts. Please try again shortly." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { code, password } = body as { code?: string; password?: string };

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Transfer code is required" }, { status: 400 });
    }

    const normalized = normalizeTransferCode(code);
    const lookupHash = hashTransferCode(normalized);

    const transfer = await getTransferByCodeHash(lookupHash);
    if (!transfer) {
      return NextResponse.json(
        { error: "Transfer not found or code is incorrect." },
        { status: 404 }
      );
    }

    // Check expiration
    if (new Date() > new Date(transfer.expiresAt)) {
      return NextResponse.json(
        { error: "This transfer has expired and is no longer accessible." },
        { status: 410 }
      );
    }

    // Check upload status
    if (transfer.uploadStatus !== "completed") {
      return NextResponse.json(
        { error: "This video transfer is still uploading or was abandoned." },
        { status: 400 }
      );
    }

    // Check download limit
    if (transfer.downloadLimit && transfer.downloadCount >= transfer.downloadLimit) {
      return NextResponse.json(
        { error: "This transfer has reached its maximum download limit." },
        { status: 410 }
      );
    }

    // Check password protection
    if (transfer.passwordHash) {
      if (!password) {
        return NextResponse.json(
          {
            passwordRequired: true,
            code: transfer.displayCode,
            message: "Password is required to access this transfer",
          },
          { status: 401 }
        );
      }

      const isValid = await verifyPassword(password, transfer.passwordHash);
      if (!isValid) {
        return NextResponse.json(
          {
            passwordRequired: true,
            error: "Incorrect password. Please try again.",
          },
          { status: 401 }
        );
      }
    }

    // Hash client IP for abuse detection audit
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    await createTransferEvent(transfer.id, "transfer_viewed", {}, ipHash);

    const publicInfo: TransferPublicInfo = {
      code: transfer.displayCode,
      originalFilename: transfer.originalFilename,
      fileSize: transfer.fileSize,
      contentType: transfer.contentType,
      expiresAt: transfer.expiresAt,
      createdAt: transfer.createdAt,
      senderMessage: transfer.senderMessage || undefined,
      allowPreview: transfer.allowPreview,
      allowOriginalDownload: transfer.allowOriginalDownload,
      integrityStatus: transfer.integrityStatus as any,
      checksumAlgorithm: transfer.checksumAlgorithm || undefined,
      checksumValue: transfer.checksumValue || undefined,
      downloadLimit: transfer.downloadLimit || undefined,
      downloadCount: transfer.downloadCount,
      passwordRequired: !!transfer.passwordHash,
      uploadStatus: transfer.uploadStatus as any,
    };

    return NextResponse.json({ transfer: publicInfo });
  } catch (error) {
    console.error("Lookup transfer error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
