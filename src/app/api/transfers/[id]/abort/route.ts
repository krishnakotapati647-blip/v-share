import { NextRequest, NextResponse } from "next/server";
import {
  getTransferById,
  getUploadSession,
  updateTransfer,
  updateUploadSession,
  createTransferEvent,
} from "@/lib/dal";
import { abortMultipartUpload } from "@/lib/storage";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transferId } = await params;
    const body = await req.json().catch(() => ({}));
    const { sessionId } = body as { sessionId?: string };

    const transfer = await getTransferById(transferId);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    if (sessionId) {
      const session = await getUploadSession(sessionId);
      if (session) {
        await abortMultipartUpload(session.objectKey, session.storageUploadId);
        await updateUploadSession(sessionId, { uploadStatus: "abandoned" });
      }
    }

    await updateTransfer(transferId, { uploadStatus: "abandoned" });
    await createTransferEvent(transferId, "upload_abandoned");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Abort upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to abort upload" },
      { status: 500 }
    );
  }
}
