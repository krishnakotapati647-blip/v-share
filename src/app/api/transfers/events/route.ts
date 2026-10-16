import { NextRequest, NextResponse } from "next/server";
import { normalizeTransferCode } from "@/lib/types";
import { hashTransferCode, verifyPassword } from "@/lib/security";
import { getTransferByCodeHash, getTransferEvents } from "@/lib/dal";

export async function POST(req: NextRequest) {
  try {
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

    if (transfer.passwordHash) {
      if (!password) {
        return NextResponse.json({ error: "Password required", passwordRequired: true }, { status: 401 });
      }
      const isValid = await verifyPassword(password, transfer.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: "Incorrect password", passwordRequired: true }, { status: 401 });
      }
    }

    const events = await getTransferEvents(transfer.id);

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error("Fetch events error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load events" },
      { status: 500 }
    );
  }
}
