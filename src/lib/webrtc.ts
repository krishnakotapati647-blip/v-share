// ==============================================
// VIDELINK — High-Speed WebRTC P2P Direct Stream Engine
// Optimized for 5GB+ transfers with in-memory block batching & zero stutter
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
  ],
  iceCandidatePoolSize: 10,
};

// High-speed chunk and buffer configurations
const PACKET_CHUNK_SIZE = 64 * 1024; // 64 KB per SCTP packet (universal browser compatibility)
const DISK_READ_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB read block from disk into RAM
const MAX_SCTP_BUFFER = 16 * 1024 * 1024; // 16 MB max buffer capacity
const LOW_WATERMARK_BUFFER = 4 * 1024 * 1024; // 4 MB low watermark to prevent stall

export interface P2PProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds
}

export type P2PStatus =
  | "initializing"
  | "waiting_for_peer"
  | "connecting"
  | "streaming"
  | "completed"
  | "failed";

// ===== Signaling Helpers =====
export async function sendSignal(
  transferId: string,
  type: "offer" | "answer" | "candidate" | "status",
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
// SENDER SESSION (High Throughput Optimized)
// ==============================================
export class P2PSenderSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private transferId: string;
  private file: File;
  private isDestroyed = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastSignalTime = 0;

  public onStatusChange?: (status: P2PStatus, message?: string) => void;
  public onProgress?: (progress: P2PProgress) => void;

  constructor(transferId: string, file: File) {
    this.transferId = transferId;
    this.file = file;
  }

  public async start() {
    this.onStatusChange?.("initializing", "Creating direct P2P session...");

    this.pc = new RTCPeerConnection(ICE_SERVERS);

    // Sender creates the DataChannel with max packet life & ordering
    this.dc = this.pc.createDataChannel("file-transfer", {
      ordered: true,
    });
    this.dc.binaryType = "arraybuffer";
    this.dc.bufferedAmountLowThreshold = LOW_WATERMARK_BUFFER;

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
        this.onStatusChange?.("failed", "P2P connection lost.");
      }
    };

    this.dc.onopen = () => {
      // Clear polling interval immediately once data channel is open
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
      this.onStatusChange?.("streaming", "Direct stream established! Sending file...");
      this.streamFile();
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

    // Fast polling (300ms) during initial handshake
    this.startPolling();
  }

  private startPolling() {
    let answered = false;

    this.pollingInterval = setInterval(async () => {
      if (this.isDestroyed) return;

      const signals = await fetchSignals(this.transferId, "sender", this.lastSignalTime);

      for (const sig of signals) {
        this.lastSignalTime = Math.max(this.lastSignalTime, sig.timestamp);

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

  private async streamFile() {
    if (!this.dc || this.isDestroyed) return;

    // Send metadata header first
    const header = JSON.stringify({
      type: "header",
      name: this.file.name,
      size: this.file.size,
      mimeType: this.file.type,
    });
    this.dc.send(header);

    const totalBytes = this.file.size;
    let offset = 0;
    const startTime = Date.now();
    let lastProgressTime = startTime;

    // Pipelined In-Memory Streaming:
    // Read in 4MB blocks to avoid thousands of small disk seeks,
    // then stream 64KB chunks directly into the socket buffer.
    while (offset < totalBytes && !this.isDestroyed) {
      const blockEnd = Math.min(offset + DISK_READ_BLOCK_SIZE, totalBytes);
      const blockSlice = this.file.slice(offset, blockEnd);

      // Native async block read via browser C++ engine
      let blockBuffer: ArrayBuffer;
      try {
        blockBuffer = await blockSlice.arrayBuffer();
      } catch (err) {
        console.error("File block read failed:", err);
        break;
      }

      let blockOffset = 0;
      while (blockOffset < blockBuffer.byteLength && !this.isDestroyed) {
        // High-watermark check: pause only if buffer is saturated
        if (this.dc.bufferedAmount > MAX_SCTP_BUFFER) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              this.dc?.removeEventListener("bufferedamountlow", onLow);
              resolve();
            };
            this.dc?.addEventListener("bufferedamountlow", onLow);
          });
        }

        const chunkEnd = Math.min(blockOffset + PACKET_CHUNK_SIZE, blockBuffer.byteLength);
        const chunk = blockBuffer.slice(blockOffset, chunkEnd);
        this.dc.send(chunk);

        blockOffset += chunk.byteLength;
        offset += chunk.byteLength;

        // Throttle progress updates to UI every 150ms to keep 60fps
        const now = Date.now();
        if (now - lastProgressTime > 150 || offset === totalBytes) {
          const elapsed = (now - startTime) / 1000;
          const speed = elapsed > 0 ? offset / elapsed : 0;
          const remainingBytes = totalBytes - offset;
          const eta = speed > 0 ? remainingBytes / speed : 0;

          this.onProgress?.({
            bytesTransferred: offset,
            totalBytes,
            percentage: Math.min(100, Math.round((offset / totalBytes) * 100)),
            speed,
            eta,
          });

          lastProgressTime = now;
        }
      }
    }

    if (!this.isDestroyed) {
      // Send end marker
      this.dc.send(JSON.stringify({ type: "complete" }));
      this.onStatusChange?.("completed", "Transfer completed successfully!");
    }
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
// RECEIVER SESSION (High Throughput Optimized)
// ==============================================
export class P2PReceiverSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private transferId: string;
  private isDestroyed = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastSignalTime = 0;

  private receivedChunks: ArrayBuffer[] = [];
  private receivedBytes = 0;
  private totalBytes = 0;
  private fileMeta: { name: string; size: number; mimeType: string } | null = null;
  private startTime = 0;
  private lastProgressTime = 0;

  public onStatusChange?: (status: P2PStatus, message?: string) => void;
  public onProgress?: (progress: P2PProgress) => void;
  public onFileReceived?: (blob: Blob, filename: string) => void;

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
        // Clear polling interval immediately once data channel is open
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        this.onStatusChange?.("streaming", "Direct stream established! Receiving file...");
        this.startTime = Date.now();
        this.lastProgressTime = this.startTime;
      };

      this.dc.onmessage = (e) => {
        if (typeof e.data === "string") {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "header") {
              this.fileMeta = {
                name: msg.name,
                size: msg.size,
                mimeType: msg.mimeType,
              };
              this.totalBytes = msg.size;
              this.startTime = Date.now();
              this.lastProgressTime = this.startTime;
            } else if (msg.type === "complete") {
              this.finalizeDownload();
            }
          } catch {}
        } else if (e.data instanceof ArrayBuffer) {
          this.receivedChunks.push(e.data);
          this.receivedBytes += e.data.byteLength;

          // Throttle progress updates to 150ms so React doesn't freeze the DOM
          const now = Date.now();
          if (now - this.lastProgressTime > 150 || this.receivedBytes === this.totalBytes) {
            const elapsed = (now - this.startTime) / 1000;
            const speed = elapsed > 0 ? this.receivedBytes / elapsed : 0;
            const remainingBytes = this.totalBytes - this.receivedBytes;
            const eta = speed > 0 ? remainingBytes / speed : 0;

            this.onProgress?.({
              bytesTransferred: this.receivedBytes,
              totalBytes: this.totalBytes || this.receivedBytes,
              percentage: this.totalBytes
                ? Math.min(100, Math.round((this.receivedBytes / this.totalBytes) * 100))
                : 0,
              speed,
              eta,
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
        this.onStatusChange?.("failed", "P2P connection lost.");
      }
    };

    // Fast polling (300ms) to connect as fast as possible
    this.startReceiverPolling();
  }

  private startReceiverPolling() {
    let answered = false;

    this.pollingInterval = setInterval(async () => {
      if (this.isDestroyed) return;

      const signals = await fetchSignals(this.transferId, "receiver", this.lastSignalTime);

      for (const sig of signals) {
        this.lastSignalTime = Math.max(this.lastSignalTime, sig.timestamp);

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

  private finalizeDownload() {
    const filename = this.fileMeta?.name || "downloaded_video.mp4";
    const mimeType = this.fileMeta?.mimeType || "video/mp4";
    const blob = new Blob(this.receivedChunks, { type: mimeType });

    this.onStatusChange?.("completed", "Video received successfully in original quality!");
    this.onFileReceived?.(blob, filename);

    // Auto-trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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
