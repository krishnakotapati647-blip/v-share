// ==============================================
// VIDELINK — Ultra High-Speed Multi-Channel WebRTC P2P Engine
// 4x Parallel Unordered DataChannels + Custom Sequence Reassembly
// Designed to saturate full mobile network bandwidth (4G/5G)
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

// ===== Speed-Tuned Constants =====
// Each channel uses 64KB chunks. With 4 parallel channels, aggregate burst = 256 KB per cycle.
// Total in-flight buffer across all channels: 4 x 4 MB = 16 MB, allowing massive burst throughput.
const NUM_CHANNELS = 4; // Number of parallel DataChannels
const PACKET_CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
const DISK_READ_BLOCK_SIZE = 4 * 1024 * 1024; // 4 MB disk read block
const HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB per channel
const LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB per channel

// Header: 4 bytes sequence number prepended to each binary chunk
const SEQ_HEADER_SIZE = 4;

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

// ===== Helper: Encode sequence number into 4-byte header =====
function encodeSeqHeader(seq: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (seq >>> 24) & 0xff;
  buf[1] = (seq >>> 16) & 0xff;
  buf[2] = (seq >>> 8) & 0xff;
  buf[3] = seq & 0xff;
  return buf;
}

function decodeSeqHeader(buf: ArrayBuffer): number {
  const view = new Uint8Array(buf, 0, 4);
  return ((view[0] << 24) | (view[1] << 16) | (view[2] << 8) | view[3]) >>> 0;
}

// ==============================================
// SENDER SESSION (Multi-Channel, Multi-file & Instant Cancel)
// ==============================================
export class P2PSenderSession {
  private pc: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private dataChannels: RTCDataChannel[] = [];
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
    this.onStatusChange?.("initializing", "Creating multi-channel P2P session...");

    this.pc = new RTCPeerConnection(ICE_SERVERS);

    // Create control channel (ordered, reliable) for metadata messages
    this.controlChannel = this.pc.createDataChannel("control", {
      ordered: true,
    });
    this.controlChannel.binaryType = "arraybuffer";

    // Create NUM_CHANNELS parallel unordered data channels for maximum throughput
    for (let i = 0; i < NUM_CHANNELS; i++) {
      const dc = this.pc.createDataChannel(`data-${i}`, {
        ordered: false,
        maxRetransmits: 3, // Allow a few retransmits for reliability, but not infinite
      });
      dc.binaryType = "arraybuffer";
      dc.bufferedAmountLowThreshold = LOW_WATERMARK;
      this.dataChannels.push(dc);
    }

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

    // Listen for cancel messages on control channel
    this.controlChannel.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "cancel") {
            this.handlePeerCancelled(msg.by || "receiver", msg.reason);
          }
        } catch {}
      }
    };

    // Wait for all channels to open, then start streaming
    let openCount = 0;
    const totalChannelsToOpen = NUM_CHANNELS + 1; // data channels + control channel

    const checkAllOpen = () => {
      openCount++;
      if (openCount >= totalChannelsToOpen) {
        // Clear polling interval once all channels are established
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        this.onStatusChange?.("streaming", "All channels established! Sending files at maximum speed...");
        this.streamFiles();
      }
    };

    this.controlChannel.onopen = checkAllOpen;
    for (const dc of this.dataChannels) {
      dc.onopen = checkAllOpen;
    }

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
          this.onStatusChange?.("connecting", "Receiver joined! Connecting multi-channel...");
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

  // Wait for a specific channel's buffer to drain below LOW_WATERMARK
  private async waitForDrain(dc: RTCDataChannel): Promise<void> {
    if (dc.bufferedAmount <= HIGH_WATERMARK) return;
    return new Promise<void>((resolve) => {
      let resolved = false;
      const onLow = () => {
        if (!resolved) {
          resolved = true;
          dc.removeEventListener("bufferedamountlow", onLow);
          resolve();
        }
      };
      dc.addEventListener("bufferedamountlow", onLow);
      // Immediate check in case buffer already drained
      if (dc.bufferedAmount <= LOW_WATERMARK) {
        onLow();
      }
    });
  }

  // Select the channel with the lowest buffered amount for load balancing
  private selectChannel(): RTCDataChannel {
    let minBuffered = Infinity;
    let bestChannel = this.dataChannels[0];
    for (const dc of this.dataChannels) {
      if (dc.bufferedAmount < minBuffered) {
        minBuffered = dc.bufferedAmount;
        bestChannel = dc;
      }
    }
    return bestChannel;
  }

  private async streamFiles() {
    if (!this.controlChannel || this.dataChannels.length === 0 || this.isDestroyed || this.isCancelled) return;

    // Send Manifest on control channel
    const manifest = {
      type: "manifest",
      totalFiles: this.files.length,
      totalBytes: this.totalBytes,
      numChannels: NUM_CHANNELS,
      files: this.files.map((f, i) => ({
        index: i,
        name: f.name,
        size: f.size,
        mimeType: f.type || "video/mp4",
      })),
    };
    this.controlChannel.send(JSON.stringify(manifest));

    const startTime = Date.now();
    let lastProgressTime = startTime;
    let totalBytesSentSoFar = 0;
    let globalSeq = 0; // Global sequence counter across all chunks

    for (let fileIndex = 0; fileIndex < this.files.length; fileIndex++) {
      if (this.isDestroyed || this.isCancelled) return;

      const file = this.files[fileIndex];

      // Send file start header on control channel
      this.controlChannel.send(
        JSON.stringify({
          type: "file_start",
          fileIndex,
          name: file.name,
          size: file.size,
          mimeType: file.type || "video/mp4",
          startSeq: globalSeq, // Tell receiver what sequence number this file starts at
        })
      );

      let fileOffset = 0;
      const fileSize = file.size;
      const fileChunkCount = Math.ceil(fileSize / PACKET_CHUNK_SIZE);

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
          // Select the least-loaded channel
          const dc = this.selectChannel();

          // Wait for buffer drain if this channel is overloaded
          if (dc.bufferedAmount > HIGH_WATERMARK) {
            await this.waitForDrain(dc);
          }

          if (this.isDestroyed || this.isCancelled) return;

          const chunkEnd = Math.min(blockOffset + PACKET_CHUNK_SIZE, blockBuffer.byteLength);
          const rawChunk = blockBuffer.slice(blockOffset, chunkEnd);

          // Prepend 4-byte sequence header for ordered reassembly
          const seqHeader = encodeSeqHeader(globalSeq);
          const framedChunk = new Uint8Array(SEQ_HEADER_SIZE + rawChunk.byteLength);
          framedChunk.set(seqHeader, 0);
          framedChunk.set(new Uint8Array(rawChunk), SEQ_HEADER_SIZE);

          dc.send(framedChunk.buffer);
          globalSeq++;

          blockOffset += rawChunk.byteLength;
          fileOffset += rawChunk.byteLength;

          // Progress updates (throttled to ~120ms)
          const now = Date.now();
          if (now - lastProgressTime > 120 || (fileIndex === this.files.length - 1 && fileOffset === fileSize)) {
            // Sum buffered amounts across all channels
            let totalBuffered = 0;
            for (const ch of this.dataChannels) {
              totalBuffered += ch.bufferedAmount || 0;
            }
            const currentDispatchedTotal = Math.max(0, totalBytesSentSoFar + fileOffset - totalBuffered);
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

      // Send file end marker on control channel with the sequence range
      this.controlChannel.send(
        JSON.stringify({
          type: "file_end",
          fileIndex,
          endSeq: globalSeq, // Total chunks sent for this file
          totalChunks: Math.ceil(file.size / PACKET_CHUNK_SIZE),
        })
      );

      totalBytesSentSoFar += fileSize;
    }

    if (!this.isDestroyed && !this.isCancelled) {
      // Wait for all channel buffers to flush before declaring complete
      for (const dc of this.dataChannels) {
        while (dc.bufferedAmount > 0) {
          await new Promise(r => setTimeout(r, 50));
          if (this.isDestroyed || this.isCancelled) return;
        }
      }

      // Small delay to let receiver process remaining chunks
      await new Promise(r => setTimeout(r, 300));

      // Send batch complete marker on control channel
      this.controlChannel.send(JSON.stringify({ type: "batch_complete", totalSeq: globalSeq }));
      this.onStatusChange?.("completed", "All files transferred successfully!");
    }
  }

  public cancel(by: "sender" | "receiver" = "sender", reason = "Transfer cancelled by sender") {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;

    // Direct cancel message on control channel
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      try {
        this.controlChannel.send(JSON.stringify({ type: "cancel", by, reason }));
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
    if (this.controlChannel) {
      try { this.controlChannel.close(); } catch {}
    }
    for (const dc of this.dataChannels) {
      try { dc.close(); } catch {}
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
    }
  }
}

// ==============================================
// RECEIVER SESSION (Multi-Channel, Multi-file & Instant Cancel)
// ==============================================
export class P2PReceiverSession {
  private pc: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private dataChannels: RTCDataChannel[] = [];
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
  private currentFileStartSeq = 0;
  private currentFileExpectedChunks = 0;

  // Sequence-ordered chunk reassembly buffer
  // For unordered channels, chunks may arrive out of order.
  // We use a Map<seq, ArrayBuffer> and flush sequentially.
  private chunkMap: Map<number, ArrayBuffer> = new Map();
  private nextExpectedSeq = 0;
  private flushedBlobs: Blob[] = [];
  private pendingFlushSize = 0;

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

    // When Sender's DataChannels arrive
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.binaryType = "arraybuffer";

      if (channel.label === "control") {
        // Control channel for metadata messages
        this.controlChannel = channel;

        channel.onopen = () => {
          this.onStatusChange?.("streaming", "Control channel established!");
          this.startTime = Date.now();
          this.lastProgressTime = this.startTime;
        };

        channel.onmessage = (e) => {
          if (typeof e.data === "string") {
            this.handleControlMessage(e.data);
          }
        };
      } else if (channel.label.startsWith("data-")) {
        // Data channel for binary chunks
        this.dataChannels.push(channel);

        channel.onopen = () => {
          if (this.pollingInterval && this.dataChannels.length >= NUM_CHANNELS) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
          this.onStatusChange?.("streaming", `${this.dataChannels.length} data channels active! Receiving at maximum speed...`);
        };

        channel.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            this.handleDataChunk(e.data);
          }
        };
      }
    };

    // Connection state
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "connected") {
        this.onStatusChange?.("streaming", "Connected directly to sender! Multi-channel streaming...");
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

  private handleControlMessage(data: string) {
    try {
      const msg = JSON.parse(data);
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
        this.currentFileStartSeq = msg.startSeq ?? this.nextExpectedSeq;
        this.flushedBlobs = [];
        this.pendingFlushSize = 0;
        // Don't clear chunkMap — there may be pre-arrived out-of-order chunks
      } else if (msg.type === "file_end") {
        // Flush any remaining buffered chunks for this file
        this.flushSequentialChunks();
        this.finalizeCurrentFile();
      } else if (msg.type === "batch_complete" || msg.type === "complete") {
        // Flush any remaining
        this.flushSequentialChunks();
        if (this.flushedBlobs.length > 0 || this.chunkMap.size > 0) {
          this.finalizeCurrentFile();
        }
        this.onStatusChange?.("completed", "All files received successfully in original quality!");
        this.onBatchComplete?.();
      }
    } catch {}
  }

  private handleDataChunk(data: ArrayBuffer) {
    if (data.byteLength <= SEQ_HEADER_SIZE) return;

    // Extract sequence number from 4-byte header
    const seq = decodeSeqHeader(data);
    const payload = data.slice(SEQ_HEADER_SIZE);

    // Store in map
    this.chunkMap.set(seq, payload);
    this.currentFileReceivedBytes += payload.byteLength;
    this.totalReceivedBytes += payload.byteLength;

    // Try to flush sequential chunks from the map
    this.flushSequentialChunks();

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

  // Flush chunks that are in sequential order starting from nextExpectedSeq
  private flushSequentialChunks() {
    const BLOB_CONSOLIDATION_SIZE = 8 * 1024 * 1024; // 8 MB
    const batchChunks: ArrayBuffer[] = [];

    while (this.chunkMap.has(this.nextExpectedSeq)) {
      const chunk = this.chunkMap.get(this.nextExpectedSeq)!;
      this.chunkMap.delete(this.nextExpectedSeq);
      batchChunks.push(chunk);
      this.pendingFlushSize += chunk.byteLength;
      this.nextExpectedSeq++;

      // Consolidate into a Blob every 8MB to prevent GC pressure
      if (this.pendingFlushSize >= BLOB_CONSOLIDATION_SIZE) {
        this.flushedBlobs.push(new Blob(batchChunks));
        batchChunks.length = 0;
        this.pendingFlushSize = 0;
      }
    }

    // Store remaining batch chunks
    if (batchChunks.length > 0) {
      this.flushedBlobs.push(new Blob(batchChunks));
    }
  }

  private finalizeCurrentFile() {
    if (!this.currentFileMeta) return;

    // Flush any remaining in the map
    this.flushSequentialChunks();

    // If there are still out-of-order chunks in the map, force-flush them
    // (This handles edge cases where some chunks arrived but seq gaps exist)
    if (this.chunkMap.size > 0) {
      const sortedSeqs = Array.from(this.chunkMap.keys()).sort((a, b) => a - b);
      const remainingChunks: ArrayBuffer[] = [];
      for (const seq of sortedSeqs) {
        remainingChunks.push(this.chunkMap.get(seq)!);
        this.chunkMap.delete(seq);
      }
      if (remainingChunks.length > 0) {
        this.flushedBlobs.push(new Blob(remainingChunks));
      }
      this.nextExpectedSeq = (sortedSeqs[sortedSeqs.length - 1] ?? this.nextExpectedSeq) + 1;
    }

    const filename = this.currentFileMeta.name || `video_${this.currentFileIndex + 1}.mp4`;
    const mimeType = this.currentFileMeta.mimeType || "video/mp4";
    const blob = new Blob(this.flushedBlobs, { type: mimeType });

    // Release blob chunks from memory
    this.flushedBlobs = [];
    this.pendingFlushSize = 0;

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

  public cancel(by: "sender" | "receiver" = "receiver", reason = "Transfer cancelled by recipient") {
    if (this.isCancelled || this.isDestroyed) return;
    this.isCancelled = true;

    if (this.controlChannel && this.controlChannel.readyState === "open") {
      try {
        this.controlChannel.send(JSON.stringify({ type: "cancel", by, reason }));
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
    if (this.controlChannel) {
      try { this.controlChannel.close(); } catch {}
    }
    for (const dc of this.dataChannels) {
      try { dc.close(); } catch {}
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
    }
  }
}
