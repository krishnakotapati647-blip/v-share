import { NextRequest, NextResponse } from "next/server";
import { getExpiredTransfers, markTransferExpired } from "@/lib/dal";
import { deleteObject, cleanupAbandonedUploads } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    // Optional secret check
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET || process.env.TRANSFER_CODE_SECRET;

    if (cronSecret && authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // 1. Process expired transfers
    const expired = await getExpiredTransfers();
    let expiredCleaned = 0;

    for (const transfer of expired) {
      try {
        if (transfer.objectKey) {
          await deleteObject(transfer.objectKey);
        }
        await markTransferExpired(transfer.id);
        expiredCleaned++;
      } catch (err) {
        console.error(`Error cleaning up expired transfer ${transfer.id}:`, err);
      }
    }

    // 2. Abort abandoned multipart uploads older than 24h
    const abandonedCleaned = await cleanupAbandonedUploads();

    return NextResponse.json({
      success: true,
      expiredTransfersCleaned: expiredCleaned,
      abandonedUploadsCleaned: abandonedCleaned,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cleanup job error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}
