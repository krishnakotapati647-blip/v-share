import { NextRequest, NextResponse } from "next/server";
import { normalizeTransferCode } from "@/lib/types";
import {
  hashTransferCode,
  verifyPassword,
  checkRateLimit,
} from "@/lib/security";
import { getTransferByCodeHash } from "@/lib/dal";
import { getPresignedPreviewUrl } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateLimit = checkRateLimit(`preview_${ip}`, 40, 60_000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
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

    if (new Date() > new Date(transfer.expiresAt)) {
      return NextResponse.json({ error: "Transfer has expired" }, { status: 410 });
    }

    if (transfer.uploadStatus !== "completed") {
      return NextResponse.json({ error: "Upload not completed" }, { status: 400 });
    }

    if (!transfer.allowPreview) {
      return NextResponse.json({ error: "Online preview is disabled for this transfer" }, { status: 403 });
    }

    if (transfer.passwordHash) {
      if (!password) {
        return NextResponse.json({ error: "Password is required", passwordRequired: true }, { status: 401 });
      }
      const isValid = await verifyPassword(password, transfer.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: "Incorrect password", passwordRequired: true }, { status: 401 });
      }
    }

    const previewUrl = await getPresignedPreviewUrl(
      transfer.objectKey,
      transfer.contentType,
      600
    );

    return NextResponse.json({
      previewUrl,
      contentType: transfer.contentType,
      originalFilename: transfer.originalFilename,
      fileSize: transfer.fileSize,
      senderMessage: transfer.senderMessage,
      expiresAt: transfer.expiresAt,
      checksumValue: transfer.checksumValue,
      integrityStatus: transfer.integrityStatus,
    });
  } catch (error) {
    console.error("Preview error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate preview" },
      { status: 500 }
    );
  }
}
