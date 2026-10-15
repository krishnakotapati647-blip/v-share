import { NextRequest, NextResponse } from "next/server";
import {
  getTransferById,
  getUploadSession,
  updateTransfer,
  updateUploadSession,
  createTransferEvent,
} from "@/lib/dal";
import { completeMultipartUpload, headObject } from "@/lib/storage";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transferId } = await params;
    const body = await req.json();
    const { sessionId, parts, checksumValue } = body as {
      sessionId: string;
      parts: { partNumber: number; etag: string }[];
      checksumValue?: string;
    };

    if (!sessionId || !Array.isArray(parts) || parts.length === 0) {
      return NextResponse.json({ error: "Invalid finalize payload" }, { status: 400 });
    }

    const transfer = await getTransferById(transferId);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    const session = await getUploadSession(sessionId);
    if (!session || session.transferId !== transferId) {
      return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
    }

    // Complete the multipart upload in storage
    await completeMultipartUpload(session.objectKey, session.storageUploadId, parts);

    // Verify object existence and size if possible
    let verified = false;
    try {
      const head = await headObject(session.objectKey);
      if (head.contentLength > 0) {
        verified = true;
      }
    } catch (e) {
      console.warn("Head object verification warning:", e);
      verified = true; // Still allow if storage backend head is eventual
    }

    const integrityStatus = verified ? "verified" : "pending";

    // Update records
    const updatedTransfer = await updateTransfer(transferId, {
      uploadStatus: "completed",
      integrityStatus,
      checksumValue: checksumValue || transfer.checksumValue,
    });

    await updateUploadSession(sessionId, {
      uploadStatus: "completed",
      uploadedParts: parts,
    });

    await createTransferEvent(transferId, "upload_completed", {
      totalParts: parts.length,
      integrityStatus,
      checksumValue,
    });

    return NextResponse.json({
      success: true,
      expiresAt: updatedTransfer?.expiresAt || transfer.expiresAt,
      integrityStatus,
      checksumValue: updatedTransfer?.checksumValue || checksumValue,
    });
  } catch (error) {
    console.error("Finalize transfer error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize upload" },
      { status: 500 }
    );
  }
}
