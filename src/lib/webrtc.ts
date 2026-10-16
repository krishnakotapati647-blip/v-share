// ==============================================
// VIDELINK — WebRTC Peer-to-Peer Streaming Engine
// High-performance direct browser-to-browser transfer
// ==============================================

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
  ],
};

const CHUNK_SIZE = 64 * 1024; // 64 KB per WebRTC packet
const BUFFER_THRESHOLD = 8 * 1024 * 1024; // 8 MB backpressure threshold

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
// SENDER SESSION
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

    // Sender creates the DataChannel
    this.dc = this.pc.createDataChannel("file-transfer", {
      ordered: true,
    });
    this.dc.binaryType = "arraybuffer";

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

    // Poll for Receiver's Answer and Candidates
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
    }, 1000);
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
    let lastOffset = 0;

    const readChunk = (start: number, end: number): Promise<ArrayBuffer> => {
      return new Promise((resolve, reject) => {
        const slice = this.file.slice(start, end);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(slice);
      });
    };

    while (offset < totalBytes && !this.isDestroyed) {
      // Check buffer backpressure
      if (this.dc.bufferedAmount > BUFFER_THRESHOLD) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            this.dc?.removeEventListener("bufferedamountlow", handler);
            resolve();
          };
          this.dc?.addEventListener("bufferedamountlow", handler);
        });
      }

      const chunk = await readChunk(offset, Math.min(offset + CHUNK_SIZE, totalBytes));
      this.dc.send(chunk);
      offset += chunk.byteLength;

      // Calculate speed and ETA every 250ms
      const now = Date.now();
      if (now - lastProgressTime > 250 || offset === totalBytes) {
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
// RECEIVER SESSION
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
        this.onStatusChange?.("streaming", "Direct stream established! Receiving file...");
        this.startTime = Date.now();
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
            } else if (msg.type === "complete") {
              this.finalizeDownload();
            }
          } catch {}
        } else if (e.data instanceof ArrayBuffer) {
          this.receivedChunks.push(e.data);
          this.receivedBytes += e.data.byteLength;

          const now = Date.now();
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

    // Fetch Sender's Offer and respond with Answer
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
    }, 1000);
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
