// ==============================================
// VIDELINK — Ultra High-Speed WebRTC P2P Direct Stream Engine
// Multi-File Batch Transfer, Instant Cancellation & Zero-Stutter Flow Control
// ==============================================

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.services.mozilla.com" },
    { urls: "stun:stun.relay.metered.ca:80" },
  ],
  iceCandidatePoolSize: 10,
};

// High-Speed Mobile Data Tuned Configurations:
// 64 KB packet chunk is the universal maximum SCTP message size without fragmentation.
// HIGH_WATERMARK (4 MB): Buffer fills up to 4MB, allowing the cellular modem to transmit at maximum radio throughput.
// LOW_WATERMARK (1 MB): When buffer drains to 1MB, sender wakes up and pushes 3MB in a tight burst.
// This eliminates the stop-and-go bottleneck and achieves full physical bandwidth!
const PACKET_CHUNK_SIZE = 64 * 1024; // 64 KB
const DISK_READ_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB read block
const HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB
const LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB

export interface P2PFileMeta {
  index: number;
  name: string;
  size: number;
  mimeType: string;
}

export interface P2PProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds
  currentFileIndex?: number;
  totalFiles?: number;
  currentFileName?: string;
  currentFileBytesTransferred?: number;
  currentFileTotalBytes?: number;
  currentFilePercentage?: number;
}

export type P2PStatus =
  | "initializing"
  | "waiting_for_peer"
  | "connecting"
  | "streaming"
  | "completed"
  | "cancelled"
  | "failed";

// ===== Signaling Helpers =====
export async function sendSignal(
  transferId: string,
  type: "offer" | "answer" | "candidate" | "status" | "cancel",
  data: any,
  from: "sender" | "receiver"
) {
  try {
    await fetch(`/api/transfers/${transferId}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data, from }),
    });
  } catch (err) {
    console.warn("Signal send failed:", err);
  }
}

export async function fetchSignals(
  transferId: string,
  forRole: "sender" | "receiver",
  since: number = 0
) {
  try {
    const res = await fetch(
      `/api/transfers/${transferId}/signal?role=${forRole}&since=${since}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.signals || [];
  } catch (err) {
    console.warn("Signal fetch failed:", err);
    return [];
  }
}

// ==============================================
// SENDER SESSION (Multi-file & Instant Cancel)
// ==============================================
export class P2PSenderSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private transferId: string;
  private files: File[];
  private totalBytes: number;
  private isDestroyed = false;
  private isCancelled = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastSignalTime = 0;

  public onStatusChange?: (status: P2PStatus, message?: string) => void;
  public onProgress?: (progress: P2PProgress) => void;

  constructor(transferId: string, files: File | File[]) {
    this.transferId = transferId;
    this.files = Array.isArray(files) ? files : [files];
    this.totalBytes = this.files.reduce((acc, f) => acc + f.size, 0);
  }

  public async start() {
    this.onStatusChange?.("initializing", "Creating direct P2P session...");

    this.pc = new RTCPeerConnection(ICE_SERVERS);

    // Sender creates the DataChannel with ordering
    this.dc = this.pc.createDataChannel("file-transfer", {
      ordered: true,
    });
    this.dc.binaryType = "arraybuffer";
    this.dc.bufferedAmountLowThreshold = LOW_WATERMARK;

    // ICE candidate gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(
          this.transferId,
          "candidate",
          event.candidate.toJSON(),
          "sender"
        );
      }
    };

    // Connection state
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "connected") {
        this.onStatusChange?.("streaming", "Connected! Streaming video...");
      } else if (
        this.pc?.connectionState === "failed" ||
        this.pc?.connectionState === "disconnected"
      ) {
        if (!this.isCancelled && !this.isDestroyed) {
          this.onStatusChange?.("failed", "P2P connection lost.");
        }
      }
    };

    this.dc.onopen = () => {
      // Clear polling interval once data channel is established
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
      this.onStatusChange?.("streaming", "Direct stream established! Sending files...");
      this.streamFiles();
    };

    this.dc.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "cancel") {
            this.handlePeerCancelled(msg.by || "receiver", msg.reason);
          }
        } catch {}
      }
    };

    // Create SDP Offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await sendSignal(
      this.transferId,
      "offer",
      { sdp: offer.sdp, type: offer.type },
      "sender"
    );

    this.onStatusChange?.(
      "waiting_for_peer",
      "Waiting for receiver to enter code and connect..."
    );

    // Handshake polling
    this.startPolling();
  }

  private startPolling() {
    let answered = false;

    this.pollingInterval = setInterval(async () => {
      if (this.isDestroyed || this.isCancelled) return;

      const signals = await fetchSignals(this.transferId, "sender", this.lastSignalTime);

      for (const sig of signals) {
        this.lastSignalTime = Math.max(this.lastSignalTime, sig.timestamp);

        if ((sig.type === "cancel" || sig.type === "status") && sig.data?.status === "cancelled") {
          this.handlePeerCancelled(sig.data.by || "receiver", sig.data.reason);
          return;
        }

        if (sig.type === "answer" && !answered && this.pc) {
          answered = true;
          this.onStatusChange?.("connecting", "Receiver joined! Connecting...");
          try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(sig.data));
          } catch (e) {
            console.error("Error setting remote description:", e);
          }
        } else if (sig.type === "candidate" && this.pc && this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(sig.data));
          } catch (e) {
            console.error("Error adding ICE candidate:", e);
          }
        }
      }
    }, 300);
  }

  private async streamFiles() {
    if (!this.dc || this.isDestroyed || this.isCancelled) return;

    // Send Manifest
    const manifest = {
      type: "manifest",
      totalFiles: this.files.length,
      totalBytes: this.totalBytes,
      files: this.files.map((f, i) => ({
        index: i,
        name: f.name,
        size: f.size,
        mimeType: f.type || "video/mp4",
      })),
    };
    this.dc.send(JSON.stringify(manifest));

    const startTime = Date.now();
    let lastProgressTime = startTime;
    let totalBytesSentSoFar = 0;

    for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
      if (this.isDestroyed || this.isCancelled) return;

      const file = this.files[fileIndex];

      // Send file start header
      this.dc.send(
        JSON.stringify({
          type: "file_start",
          fileIndex,
          name: file.name,
          size: file.size,
          mimeType: file.type || "video/mp4",
        })
      );

      let fileOffset = 0;
      const fileSize = file.size;

      while (fileOffset < fileSize && !this.isDestroyed && !this.isCancelled) {
        const blockEnd = Math.min(fileOffset + DISK_READ_BLOCK_SIZE, fileSize);
        const blockSlice = file.slice(fileOffset, blockEnd);

        let blockBuffer: ArrayBuffer;
        try {
          blockBuffer = await blockSlice.arrayBuffer();
        } catch (err) {
          console.error("File block read failed:", err);
          this.onStatusChange?.("failed", "Failed to read file from disk.");
          return;
        }

        let blockOffset = 0;
        while (blockOffset < blockBuffer.byteLength && !this.isDestroyed && !this.isCancelled) {
          // High-Throughput Hysteresis Flow Control:
          // Blasts 64KB chunks continuously into the socket buffer until HIGH_WATERMARK (4 MB).
          // Only pauses when full (4 MB), and wakes up when drained to LOW_WATERMARK (1 MB),
          // giving a 3 MB uninterrupted continuous blast without stop-and-go delays.
          if (this.dc.bufferedAmount > HIGH_WATERMARK) {
            await new Promise<void>((resolve) => {
              let resolved = false;
              const onLow = () => {
                if (!resolved) {
                  resolved = true;
                  this.dc?.removeEventListener("bufferedamountlow", onLow);
                  resolve();
                }
              };
              this.dc?.addEventListener("bufferedamountlow", onLow);

              // Immediate check in case buffer already drained
              if ((this.dc?.bufferedAmount || 0) <= LOW_WATERMARK) {
                onLow();
              }
            });
          }

          if (this.isDestroyed || this.isCancelled) return;

          const chunkEnd = Math.min(blockOffset + PACKET_CHUNK_SIZE, blockBuffer.byteLength);
          const chunk = blockBuffer.slice(blockOffset, chunkEnd);
          this.dc.send(chunk);

          blockOffset += chunk.byteLength;
          fileOffset += chunk.byteLength;

          // True speed calculation based on actual dispatched bytes leaving the network buffer
          const now = Date.now();
          if (now - lastProgressTime > 120 || (fileIndex === this.files.length - 1 && fileOffset === fileSize)) {
            const buffered = this.dc?.bufferedAmount || 0;
            const currentDispatchedTotal = Math.max(0, totalBytesSentSoFar + fileOffset - buffered);
            const elapsed = (now - startTime) / 1000;
            const speed = elapsed > 0 ? currentDispatchedTotal / elapsed : 0;
            const remaining = Math.max(0, this.totalBytes - currentDispatchedTotal);
            const eta = speed > 0 ? remaining / speed : 0;

            this.onProgress?.({
              bytesTransferred: currentDispatchedTotal,
              totalBytes: this.totalBytes,
              percentage: this.totalBytes > 0 ? Math.min(100, Math.round((currentDispatchedTotal / this.totalBytes) * 100)) : 0,
              speed,
              eta,
              currentFileIndex: fileIndex,
              totalFiles: this.files.length,
              currentFileName: file.name,
              currentFileBytesTransferred: fileOffset,
              currentFileTotalBytes: fileSize,
              currentFilePercentage: fileSize > 0 ? Math.min(100, Math.round((fileOffset / fileSize) * 100)) : 0,
            });

            lastProgressTime = now;
          }
        }
      }

      if (this.isDestroyed || this.isCancelled) return;

      // Send file end marker
      this.dc.send(
        JSON.stringify({
          type: "file_end",
          fileIndex,
        })
      );

      totalBytesSentSoFar += fileSize;
    }

    if (!this.isDestroyed && !this.isCancelled) {
      // Send batch complete marker
      this.dc.send(JSON.stringify({ type: "batch_complete" }));
      this.onStatusChange?.("completed", "All files transferred successfully!");
    }
  }

  public cancel(by: "sender" | "receiver" = "sender", reason = "Transfer cancelled by sender") {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;

    // Direct DataChannel cancel message
    if (this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(JSON.stringify({ type: "cancel", by, reason }));
      } catch {}
    }

    // Signaling server notification
    sendSignal(this.transferId, "status", { status: "cancelled", by, reason }, "sender");

    const message = by === "sender" ? "Transfer cancelled by you" : "Transfer was cancelled by recipient";
    this.onStatusChange?.("cancelled", message);
    this.destroy();
  }

  private handlePeerCancelled(by: "sender" | "receiver", reason?: string) {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;
    const message = by === "sender" ? "Transfer cancelled by sender" : "Transfer was cancelled by recipient";
    this.onStatusChange?.("cancelled", message);
    this.destroy();
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
    }
  }
}

// ==============================================
// RECEIVER SESSION (Multi-file & Instant Cancel)
// ==============================================
export class P2PReceiverSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private transferId: string;
  private isDestroyed = false;
  private isCancelled = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastSignalTime = 0;

  // Stream state
  private fileList: P2PFileMeta[] = [];
  private totalFiles = 1;
  private totalBytes = 0;
  private totalReceivedBytes = 0;

  // Current file state
  private currentFileIndex = 0;
  private currentFileMeta: P2PFileMeta | null = null;
  private currentFileReceivedBytes = 0;
  private chunkBuffer: ArrayBuffer[] = [];
  private chunkBufferSize = 0;
  private currentFileBlobs: Blob[] = [];

  private startTime = 0;
  private lastProgressTime = 0;

  public onStatusChange?: (status: P2PStatus, message?: string) => void;
  public onProgress?: (progress: P2PProgress) => void;
  public onManifestReceived?: (files: P2PFileMeta[], totalBytes: number) => void;
  public onFileReceived?: (blob: Blob, filename: string, fileIndex: number, totalFiles: number) => void;
  public onBatchComplete?: () => void;

  constructor(transferId: string) {
    this.transferId = transferId;
  }

  public async start() {
    this.onStatusChange?.("initializing", "Looking up sender session...");

    this.pc = new RTCPeerConnection(ICE_SERVERS);

    // ICE candidate gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(
          this.transferId,
          "candidate",
          event.candidate.toJSON(),
          "receiver"
        );
      }
    };

    // When Sender's DataChannel arrives
    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.dc.binaryType = "arraybuffer";

      this.dc.onopen = () => {
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        this.onStatusChange?.("streaming", "Direct stream established! Receiving files...");
        this.startTime = Date.now();
        this.lastProgressTime = this.startTime;
      };

      this.dc.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "cancel") {
              this.handlePeerCancelled(msg.by || "sender", msg.reason);
              return;
            } else if (msg.type === "manifest") {
              this.totalFiles = msg.totalFiles;
              this.totalBytes = msg.totalBytes;
              this.fileList = msg.files || [];
              this.onManifestReceived?.(this.fileList, this.totalBytes);
            } else if (msg.type === "file_start") {
              this.currentFileIndex = msg.fileIndex ?? 0;
              this.currentFileMeta = {
                index: msg.fileIndex ?? 0,
                name: msg.name,
                size: msg.size,
                mimeType: msg.mimeType,
              };
              this.currentFileReceivedBytes = 0;
              this.currentFileBlobs = [];
              this.chunkBuffer = [];
              this.chunkBufferSize = 0;
            } else if (msg.type === "file_end") {
              this.finalizeCurrentFile();
            } else if (msg.type === "batch_complete" || msg.type === "complete") {
              if (this.currentFileBlobs.length > 0 || this.chunkBuffer.length > 0) {
                this.finalizeCurrentFile();
              }
              this.onStatusChange?.("completed", "All files received successfully in original quality!");
              this.onBatchComplete?.();
            }
          } catch {}
        } else if (e.data instanceof ArrayBuffer) {
          // Accumulate chunk in memory
          this.chunkBuffer.push(e.data);
          this.chunkBufferSize += e.data.byteLength;
          this.currentFileReceivedBytes += e.data.byteLength;
          this.totalReceivedBytes += e.data.byteLength;

          // Merge into native Blob every 8MB to prevent tiny ArrayBuffers from choking GC
          if (this.chunkBufferSize >= 8 * 1024 * 1024) {
            this.currentFileBlobs.push(new Blob(this.chunkBuffer));
            this.chunkBuffer = [];
            this.chunkBufferSize = 0;
          }

          // Throttle progress updates to 150ms
          const now = Date.now();
          if (now - this.lastProgressTime > 150 || this.totalReceivedBytes === this.totalBytes) {
            const elapsed = (now - this.startTime) / 1000;
            const speed = elapsed > 0 ? this.totalReceivedBytes / elapsed : 0;
            const remaining = Math.max(0, this.totalBytes - this.totalReceivedBytes);
            const eta = speed > 0 ? remaining / speed : 0;

            this.onProgress?.({
              bytesTransferred: this.totalReceivedBytes,
              totalBytes: this.totalBytes || this.totalReceivedBytes,
              percentage: this.totalBytes
                ? Math.min(100, Math.round((this.totalReceivedBytes / this.totalBytes) * 100))
                : 0,
              speed,
              eta,
              currentFileIndex: this.currentFileIndex,
              totalFiles: this.totalFiles,
              currentFileName: this.currentFileMeta?.name,
              currentFileBytesTransferred: this.currentFileReceivedBytes,
              currentFileTotalBytes: this.currentFileMeta?.size,
              currentFilePercentage: this.currentFileMeta?.size
                ? Math.min(100, Math.round((this.currentFileReceivedBytes / this.currentFileMeta.size) * 100))
                : 0,
            });

            this.lastProgressTime = now;
          }
        }
      };
    };

    // Connection state
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "connected") {
        this.onStatusChange?.("streaming", "Connected directly to sender! Streaming video...");
      } else if (
        this.pc?.connectionState === "failed" ||
        this.pc?.connectionState === "disconnected"
      ) {
        if (!this.isCancelled && !this.isDestroyed) {
          this.onStatusChange?.("failed", "P2P connection lost.");
        }
      }
    };

    // Handshake polling
    this.startReceiverPolling();
  }

  private startReceiverPolling() {
    let answered = false;

    this.pollingInterval = setInterval(async () => {
      if (this.isDestroyed || this.isCancelled) return;

      const signals = await fetchSignals(this.transferId, "receiver", this.lastSignalTime);

      for (const sig of signals) {
        this.lastSignalTime = Math.max(this.lastSignalTime, sig.timestamp);

        if ((sig.type === "cancel" || sig.type === "status") && sig.data?.status === "cancelled") {
          this.handlePeerCancelled(sig.data.by || "sender", sig.data.reason);
          return;
        }

        if (sig.type === "offer" && !answered && this.pc) {
          answered = true;
          this.onStatusChange?.("connecting", "Connecting to sender...");

          try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(sig.data));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);

            await sendSignal(
              this.transferId,
              "answer",
              { sdp: answer.sdp, type: answer.type },
              "receiver"
            );
          } catch (e) {
            console.error("Error responding to offer:", e);
          }
        } else if (sig.type === "candidate" && this.pc && this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(sig.data));
          } catch (e) {
            console.error("Error adding candidate:", e);
          }
        }
      }
    }, 300);
  }

  private finalizeCurrentFile() {
    if (!this.currentFileMeta) return;

    if (this.chunkBuffer.length > 0) {
      this.currentFileBlobs.push(new Blob(this.chunkBuffer));
      this.chunkBuffer = [];
      this.chunkBufferSize = 0;
    }

    const filename = this.currentFileMeta.name || `video_${this.currentFileIndex + 1}.mp4`;
    const mimeType = this.currentFileMeta.mimeType || "video/mp4";
    const blob = new Blob(this.currentFileBlobs, { type: mimeType });

    // Release blob chunks from memory array
    this.currentFileBlobs = [];

    this.onFileReceived?.(blob, filename, this.currentFileIndex, this.totalFiles);

    // Auto-trigger browser download
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.warn("Auto-download failed:", e);
    }
  }

  public cancel(by: "sender" | "receiver" = "receiver", reason = "Transfer cancelled by recipient") {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;

    if (this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(JSON.stringify({ type: "cancel", by, reason }));
      } catch {}
    }

    sendSignal(this.transferId, "status", { status: "cancelled", by, reason }, "receiver");

    const message = by === "receiver" ? "Transfer cancelled by you" : "Transfer was cancelled by sender";
    this.onStatusChange?.("cancelled", message);
    this.destroy();
  }

  private handlePeerCancelled(by: "sender" | "receiver", reason?: string) {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;
    const message = by === "sender" ? "Transfer was cancelled by sender" : "Transfer was cancelled by recipient";
    this.onStatusChange?.("cancelled", message);
    this.destroy();
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
    }
  }
}
