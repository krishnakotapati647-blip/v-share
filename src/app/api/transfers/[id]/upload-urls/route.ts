import { NextRequest, NextResponse } from "next/server";
import { getTransferById, getUploadSession } from "@/lib/dal";
import { getPresignedUploadUrl } from "@/lib/storage";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transferId } = await params;
    const body = await req.json();
    const { sessionId, partNumbers } = body as {
      sessionId: string;
      partNumbers: number[];
    };

    if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
      return NextResponse.json({ error: "partNumbers array required" }, { status: 400 });
    }

    const transfer = await getTransferById(transferId);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    const session = await getUploadSession(sessionId);
    if (!session || session.transferId !== transferId) {
      return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
    }

    if (transfer.uploadStatus !== "uploading" && transfer.uploadStatus !== "pending") {
      return NextResponse.json(
        { error: `Upload cannot accept parts in status: ${transfer.uploadStatus}` },
        { status: 400 }
      );
    }

    // Generate URLs concurrently
    const urls = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const url = await getPresignedUploadUrl(
          session.objectKey,
          session.storageUploadId,
          partNumber
        );
        return {
          partNumber,
          url,
        };
      })
    );

    return NextResponse.json({ urls });
  } catch (error) {
    console.error("Generate upload URLs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate URLs" },
      { status: 500 }
    );
  }
}
