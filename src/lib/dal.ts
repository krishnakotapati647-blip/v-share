import { prisma } from "./db";
import fs from "fs";
import path from "path";

export interface StoredTransfer {
  id: string;
  codeLookupHash: string;
  displayCode: string;
  originalFilename: string;
  objectKey: string;
  fileSize: number;
  contentType: string;
  checksumAlgorithm?: string | null;
  checksumValue?: string | null;
  integrityStatus: string;
  uploadStatus: string;
  passwordHash?: string | null;
  senderMessage?: string | null;
  allowPreview: boolean;
  allowOriginalDownload: boolean;
  downloadLimit?: number | null;
  downloadCount: number;
  previewObjectKey?: string | null;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface StoredUploadSession {
  id: string;
  transferId: string;
  storageUploadId: string;
  objectKey: string;
  uploadStatus: string;
  totalParts: number;
  partSize: number;
  uploadedParts: { partNumber: number; etag: string; size?: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredTransferEvent {
  id: string;
  transferId: string;
  eventType: string;
  metadata?: any;
  ipHash?: string | null;
  createdAt: string;
}

interface LocalDatabase {
  transfers: Record<string, StoredTransfer>;
  uploadSessions: Record<string, StoredUploadSession>;
  events: StoredTransferEvent[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureLocalDb(): LocalDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial: LocalDatabase = {
      transfers: {},
      uploadSessions: {},
      events: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const content = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(content) as LocalDatabase;
  } catch {
    const initial: LocalDatabase = {
      transfers: {},
      uploadSessions: {},
      events: [],
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

function saveLocalDb(db: LocalDatabase) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tempFile = `${DB_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tempFile, DB_FILE);
}

let isPrismaAvailable: boolean | null = null;

async function checkPrisma(): Promise<boolean> {
  if (isPrismaAvailable !== null) return isPrismaAvailable;
  try {
    if (!prisma || !prisma.transfer) {
      isPrismaAvailable = false;
      return false;
    }
    // Attempt a lightweight test query with short timeout
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 2000)),
    ]);
    isPrismaAvailable = true;
    return true;
  } catch {
    isPrismaAvailable = false;
    return false;
  }
}

// ===================================
// DAL Methods
// ===================================

export async function createTransfer(data: {
  codeLookupHash: string;
  displayCode: string;
  originalFilename: string;
  objectKey: string;
  fileSize: number;
  contentType: string;
  checksumAlgorithm?: string;
  checksumValue?: string;
  integrityStatus?: string;
  uploadStatus?: string;
  passwordHash?: string;
  senderMessage?: string;
  allowPreview?: boolean;
  allowOriginalDownload?: boolean;
  downloadLimit?: number;
  expiresAt: Date;
}): Promise<StoredTransfer> {
  const hasPrisma = await checkPrisma();
  const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (hasPrisma) {
    try {
      const record = await prisma.transfer.create({
        data: {
          codeLookupHash: data.codeLookupHash,
          displayCode: data.displayCode,
          originalFilename: data.originalFilename,
          objectKey: data.objectKey,
          fileSize: BigInt(data.fileSize),
          contentType: data.contentType,
          checksumAlgorithm: data.checksumAlgorithm ?? null,
          checksumValue: data.checksumValue ?? null,
          integrityStatus: data.integrityStatus ?? "pending",
          uploadStatus: data.uploadStatus ?? "pending",
          passwordHash: data.passwordHash ?? null,
          senderMessage: data.senderMessage ?? null,
          allowPreview: data.allowPreview ?? true,
          allowOriginalDownload: data.allowOriginalDownload ?? true,
          downloadLimit: data.downloadLimit ?? null,
          expiresAt: data.expiresAt,
        },
      });
      return {
        ...record,
        fileSize: Number(record.fileSize),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch (e) {
      console.warn("Prisma transfer creation failed, falling back to local DB:", e);
    }
  }

  // Local fallback
  const db = ensureLocalDb();
  const now = new Date().toISOString();
  const transfer: StoredTransfer = {
    id,
    codeLookupHash: data.codeLookupHash,
    displayCode: data.displayCode,
    originalFilename: data.originalFilename,
    objectKey: data.objectKey,
    fileSize: data.fileSize,
    contentType: data.contentType,
    checksumAlgorithm: data.checksumAlgorithm || null,
    checksumValue: data.checksumValue || null,
    integrityStatus: data.integrityStatus || "pending",
    uploadStatus: data.uploadStatus || "pending",
    passwordHash: data.passwordHash || null,
    senderMessage: data.senderMessage || null,
    allowPreview: data.allowPreview ?? true,
    allowOriginalDownload: data.allowOriginalDownload ?? true,
    downloadLimit: data.downloadLimit || null,
    downloadCount: 0,
    previewObjectKey: null,
    createdAt: now,
    expiresAt: data.expiresAt.toISOString(),
    updatedAt: now,
  };

  db.transfers[transfer.id] = transfer;
  saveLocalDb(db);
  return transfer;
}

export async function getTransferById(id: string): Promise<StoredTransfer | null> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const record = await prisma.transfer.findUnique({ where: { id } });
      if (!record) return null;
      return {
        ...record,
        fileSize: Number(record.fileSize),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  return db.transfers[id] || null;
}

export async function getTransferByCodeHash(codeLookupHash: string): Promise<StoredTransfer | null> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const record = await prisma.transfer.findUnique({ where: { codeLookupHash } });
      if (!record) return null;
      return {
        ...record,
        fileSize: Number(record.fileSize),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  for (const t of Object.values(db.transfers)) {
    if (t.codeLookupHash === codeLookupHash) {
      return t;
    }
  }
  return null;
}

export async function updateTransfer(
  id: string,
  data: Partial<Omit<StoredTransfer, "id" | "createdAt" | "updatedAt">>
): Promise<StoredTransfer | null> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const updateData: any = { ...data };
      if (data.fileSize !== undefined) {
        updateData.fileSize = BigInt(data.fileSize);
      }
      const record = await prisma.transfer.update({
        where: { id },
        data: updateData,
      });
      return {
        ...record,
        fileSize: Number(record.fileSize),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  const existing = db.transfers[id];
  if (!existing) return null;

  const updated: StoredTransfer = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  db.transfers[id] = updated;
  saveLocalDb(db);
  return updated;
}

export async function incrementDownloadCount(id: string): Promise<number> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const record = await prisma.transfer.update({
        where: { id },
        data: { downloadCount: { increment: 1 } },
        select: { downloadCount: true },
      });
      return record.downloadCount;
    } catch {}
  }

  const db = ensureLocalDb();
  const transfer = db.transfers[id];
  if (!transfer) return 0;
  transfer.downloadCount = (transfer.downloadCount || 0) + 1;
  transfer.updatedAt = new Date().toISOString();
  saveLocalDb(db);
  return transfer.downloadCount;
}

export async function createUploadSession(data: {
  transferId: string;
  storageUploadId: string;
  objectKey: string;
  totalParts: number;
  partSize: number;
}): Promise<StoredUploadSession> {
  const hasPrisma = await checkPrisma();
  const id = `us_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (hasPrisma) {
    try {
      const record = await prisma.uploadSession.create({
        data: {
          transferId: data.transferId,
          storageUploadId: data.storageUploadId,
          objectKey: data.objectKey,
          totalParts: data.totalParts,
          partSize: data.partSize,
          uploadStatus: "uploading",
          uploadedParts: [],
        },
      });
      return {
        ...record,
        uploadedParts: (record.uploadedParts as any) || [],
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  const now = new Date().toISOString();
  const session: StoredUploadSession = {
    id,
    transferId: data.transferId,
    storageUploadId: data.storageUploadId,
    objectKey: data.objectKey,
    uploadStatus: "uploading",
    totalParts: data.totalParts,
    partSize: data.partSize,
    uploadedParts: [],
    createdAt: now,
    updatedAt: now,
  };

  db.uploadSessions[session.id] = session;
  saveLocalDb(db);
  return session;
}

export async function getUploadSession(sessionId: string): Promise<StoredUploadSession | null> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const record = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
      if (!record) return null;
      return {
        ...record,
        uploadedParts: (record.uploadedParts as any) || [],
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  return db.uploadSessions[sessionId] || null;
}

export async function updateUploadSession(
  sessionId: string,
  data: Partial<Omit<StoredUploadSession, "id" | "createdAt" | "updatedAt">>
): Promise<StoredUploadSession | null> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const record = await prisma.uploadSession.update({
        where: { id: sessionId },
        data: data as any,
      });
      return {
        ...record,
        uploadedParts: (record.uploadedParts as any) || [],
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  const existing = db.uploadSessions[sessionId];
  if (!existing) return null;

  const updated: StoredUploadSession = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  db.uploadSessions[sessionId] = updated;
  saveLocalDb(db);
  return updated;
}

export async function createTransferEvent(
  transferId: string,
  eventType: string,
  metadata: any = {},
  ipHash?: string
): Promise<StoredTransferEvent> {
  const hasPrisma = await checkPrisma();
  const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (hasPrisma) {
    try {
      const record = await prisma.transferEvent.create({
        data: {
          transferId,
          eventType,
          metadata,
          ipHash: ipHash || null,
        },
      });
      return {
        ...record,
        createdAt: record.createdAt.toISOString(),
      };
    } catch {}
  }

  const db = ensureLocalDb();
  const event: StoredTransferEvent = {
    id,
    transferId,
    eventType,
    metadata,
    ipHash: ipHash || null,
    createdAt: new Date().toISOString(),
  };

  db.events.push(event);
  saveLocalDb(db);
  return event;
}

export async function getTransferEvents(transferId: string): Promise<StoredTransferEvent[]> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const records = await prisma.transferEvent.findMany({
        where: { transferId },
        orderBy: { createdAt: "asc" },
      });
      return records.map((r: any) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch {}
  }

  const db = ensureLocalDb();
  return db.events
    .filter((e) => e.transferId === transferId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getExpiredTransfers(): Promise<StoredTransfer[]> {
  const now = new Date();
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      const records = await prisma.transfer.findMany({
        where: {
          expiresAt: { lt: now },
          uploadStatus: { not: "expired" },
        },
      });
      return records.map((r: any) => ({
        ...r,
        fileSize: Number(r.fileSize),
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    } catch {}
  }

  const db = ensureLocalDb();
  const expired: StoredTransfer[] = [];
  const nowMs = now.getTime();
  for (const t of Object.values(db.transfers)) {
    if (new Date(t.expiresAt).getTime() < nowMs && t.uploadStatus !== "expired") {
      expired.push(t);
    }
  }
  return expired;
}

export async function markTransferExpired(id: string): Promise<void> {
  await updateTransfer(id, { uploadStatus: "expired" });
  await createTransferEvent(id, "transfer_expired");
}

export async function deleteTransfer(id: string): Promise<void> {
  const hasPrisma = await checkPrisma();
  if (hasPrisma) {
    try {
      await prisma.transfer.delete({ where: { id } });
      return;
    } catch {}
  }

  const db = ensureLocalDb();
  delete db.transfers[id];
  // Remove associated sessions and events
  for (const [sId, session] of Object.entries(db.uploadSessions)) {
    if (session.transferId === id) delete db.uploadSessions[sId];
  }
  db.events = db.events.filter((e) => e.transferId !== id);
  saveLocalDb(db);
}
