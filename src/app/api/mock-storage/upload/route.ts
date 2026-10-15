import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CHUNKS_ROOT = path.join(process.cwd(), ".data", "chunks");

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const uploadId = searchParams.get("uploadId");
    const partNumber = searchParams.get("partNumber");

    if (!uploadId || !partNumber) {
      return NextResponse.json({ error: "Missing uploadId or partNumber" }, { status: 400 });
    }

    const uploadDir = path.join(CHUNKS_ROOT, uploadId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Read chunk data
    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Compute etag
    const etag = `"${crypto.createHash("md5").update(buffer).digest("hex")}"`;

    const partFilePath = path.join(uploadDir, `part_${partNumber}`);
    fs.writeFileSync(partFilePath, buffer);

    return new NextResponse(JSON.stringify({ etag, partNumber: Number(partNumber) }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("Mock upload part error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload part failed" },
      { status: 500 }
    );
  }
}
