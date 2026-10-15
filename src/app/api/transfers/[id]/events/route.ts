import { NextRequest, NextResponse } from "next/server";
import { getTransferById, getTransferEvents } from "@/lib/dal";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: transferId } = await params;
    const transfer = await getTransferById(transferId);
    if (!transfer) {
      return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
    }

    const events = await getTransferEvents(transferId);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("Get events error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get events" },
      { status: 500 }
    );
  }
}
