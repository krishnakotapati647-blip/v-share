"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  formatFileSize,
  formatDuration,
  formatSpeed,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_PART_SIZE,
  MAX_CONCURRENT_UPLOADS,
  EXPIRATION_PRESETS,
  type CreateTransferInput,
} from "@/lib/types";
import QRCode from "qrcode";
import { P2PSenderSession, type P2PProgress, type P2PStatus } from "@/lib/webrtc";

// ===== Types =====
type SendStep = "select" | "settings" | "uploading" | "complete";

interface UploadProgress {
  totalBytes: number;
  uploadedBytes: number;
  percentage: number;
  speed: number;
  eta: number;
  partsCompleted: number;
  totalParts: number;
  status: "uploading" | "paused" | "finalizing" | "error" | "complete";
  errorMessage?: string;
}

interface TransferResult {
  code: string;
  originalFilename: string;
  fileSize: number;
  expiresAt: string;
  integrityStatus: string;
  checksumValue?: string;
  downloadLimit?: number;
}

// ===== Component =====
export default function SendPage() {
  // Step management
  const [step, setStep] = useState<SendStep>("select");

  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings state
  const [transferMode, setTransferMode] = useState<"p2p" | "cloud">("p2p");
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>("waiting_for_peer");
  const [p2pStatusMsg, setP2pStatusMsg] = useState("Waiting for recipient to enter code...");
  const [p2pProgress, setP2pProgress] = useState<P2PProgress>({
    bytesTransferred: 0,
    totalBytes: 0,
    percentage: 0,
    speed: 0,
    eta: 0,
  });
  const p2pSessionRef = useRef<P2PSenderSession | null>(null);

  const [expirationHours, setExpirationHours] = useState(24);
  const [password, setPassword] = useState("");
  const [downloadLimit, setDownloadLimit] = useState<number | undefined>(undefined);
  const [senderMessage, setSenderMessage] = useState("");
  const [allowPreview, setAllowPreview] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Upload state
  const [progress, setProgress] = useState<UploadProgress>({
    totalBytes: 0,
    uploadedBytes: 0,
    percentage: 0,
    speed: 0,
    eta: 0,
    partsCompleted: 0,
    totalParts: 0,
    status: "uploading",
  });
  const uploadAbortRef = useRef(false);

  // Result state
  const [result, setResult] = useState<TransferResult | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [activeTransferNotice, setActiveTransferNotice] = useState<{ filename: string; code: string } | null>(null);

  // Check for previous active transfer on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("videlink_active_transfer");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.filename && parsed.code) {
          setActiveTransferNotice(parsed);
        }
      }
    } catch {}
  }, []);

  // Generate QR Code on completion
  useEffect(() => {
    if (result?.code) {
      const receiveUrl = `${window.location.origin}/receive?code=${encodeURIComponent(result.code)}`;
      QRCode.toDataURL(receiveUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error("QR Code error:", err));
    }
  }, [result]);

  // ===== File Selection =====
  const handleFileSelect = useCallback((file: File) => {
    // Validate extension
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext as typeof ALLOWED_EXTENSIONS[number])) {
      alert(`Unsupported file format: ${ext}\nSupported: ${ALLOWED_EXTENSIONS.join(", ")}`);
      return;
    }
    // Validate size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(`File too large: ${formatFileSize(file.size)}\nMaximum: ${formatFileSize(MAX_FILE_SIZE_BYTES)}`);
      return;
    }
    if (file.size === 0) {
      alert("Cannot upload an empty file.");
      return;
    }
    setSelectedFile(file);
    setStep("settings");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // ===== Upload Logic =====
  const startUpload = useCallback(async () => {
    if (!selectedFile) return;
    setStep("uploading");
    uploadAbortRef.current = false;

    const totalParts = Math.ceil(selectedFile.size / UPLOAD_PART_SIZE);
    setProgress({
      totalBytes: selectedFile.size,
      uploadedBytes: 0,
      percentage: 0,
      speed: 0,
      eta: 0,
      partsCompleted: 0,
      totalParts,
      status: "uploading",
    });

    try {
      const createPayload: CreateTransferInput = {
        originalFilename: selectedFile.name,
        fileSize: selectedFile.size,
        contentType: selectedFile.type || "video/mp4",
        expirationHours,
        allowPreview,
        allowOriginalDownload: true,
        checksumAlgorithm: "SHA-256",
        isP2P: transferMode === "p2p",
        transferMode,
        ...(password ? { password } : {}),
        ...(downloadLimit ? { downloadLimit } : {}),
        ...(senderMessage ? { senderMessage } : {}),
      };

      const createRes = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create transfer (${createRes.status})`);
      }

      const resData = await createRes.json();
      const { transferId, code, session, isP2P } = resData;

      if (isP2P) {
        // P2P Streaming mode
        const expDate = new Date(Date.now() + expirationHours * 3600 * 1000).toISOString();
        setResult({
          code,
          originalFilename: selectedFile.name,
          fileSize: selectedFile.size,
          expiresAt: expDate,
          integrityStatus: "verified",
          checksumValue: undefined,
          downloadLimit,
        });

        const appUrl = window.location.origin;
        const watchUrl = `${appUrl}/receive?code=${code}`;
        QRCode.toDataURL(watchUrl, {
          width: 220,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        })
          .then(setQrDataUrl)
          .catch(() => {});

        setStep("complete");

        // Initialize P2P WebRTC Session
        const p2p = new P2PSenderSession(transferId, selectedFile);
        p2pSessionRef.current = p2p;
        p2p.onStatusChange = (status, msg) => {
          setP2pStatus(status);
          if (msg) setP2pStatusMsg(msg);
        };
        p2p.onProgress = (prog) => {
          setP2pProgress(prog);
        };
        p2p.start();
        return;
      }

      try {
        localStorage.setItem(
          "videlink_active_transfer",
          JSON.stringify({
            transferId,
            code,
            filename: selectedFile.name,
            fileSize: selectedFile.size,
            timestamp: Date.now(),
          })
        );
      } catch {}

      // Step 2: Upload parts with bounded concurrency
      const partETags: { partNumber: number; etag: string }[] = [];
      let uploadedBytes = 0;
      const startTime = Date.now();

      // Get presigned URLs for all parts
      const urlRes = await fetch(`/api/transfers/${transferId}/upload-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          partNumbers: Array.from({ length: totalParts }, (_, i) => i + 1),
        }),
      });

      if (!urlRes.ok) {
        throw new Error("Failed to get upload URLs");
      }

      const { urls } = await urlRes.json();

      // Upload parts with concurrency control
      const queue = [...urls] as { partNumber: number; url: string }[];
      const inFlight = new Set<Promise<void>>();

      const uploadPart = async (part: { partNumber: number; url: string }) => {
        if (uploadAbortRef.current) return;

        const start = (part.partNumber - 1) * UPLOAD_PART_SIZE;
        const end = Math.min(start + UPLOAD_PART_SIZE, selectedFile.size);
        const chunk = selectedFile.slice(start, end);

        // Retry with exponential backoff
        let attempt = 0;
        const maxRetries = 3;

        while (attempt <= maxRetries) {
          try {
            const res = await fetch(part.url, {
              method: "PUT",
              body: chunk,
              headers: { "Content-Type": "application/octet-stream" },
            });

            if (!res.ok) throw new Error(`Part ${part.partNumber} upload failed: ${res.status}`);

            const etag = res.headers.get("etag") || `"part-${part.partNumber}"`;
            partETags.push({ partNumber: part.partNumber, etag });
            uploadedBytes += end - start;

            const elapsed = (Date.now() - startTime) / 1000;
            const speed = uploadedBytes / elapsed;
            const remaining = (selectedFile.size - uploadedBytes) / speed;

            setProgress({
              totalBytes: selectedFile.size,
              uploadedBytes,
              percentage: Math.round((uploadedBytes / selectedFile.size) * 100),
              speed,
              eta: remaining,
              partsCompleted: partETags.length,
              totalParts,
              status: "uploading",
            });

            return; // Success
          } catch (err) {
            attempt++;
            if (attempt > maxRetries) throw err;
            // Exponential backoff with jitter
            const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      };

      // Process queue with bounded concurrency
      for (const part of queue) {
        if (uploadAbortRef.current) break;

        const promise = uploadPart(part).then(() => {
          inFlight.delete(promise);
        });
        inFlight.add(promise);

        if (inFlight.size >= MAX_CONCURRENT_UPLOADS) {
          await Promise.race(inFlight);
        }
      }
      await Promise.all(inFlight);

      if (uploadAbortRef.current) {
        setProgress((p) => ({ ...p, status: "error", errorMessage: "Upload cancelled" }));
        return;
      }

      // Step 3: Finalize the upload
      setProgress((p) => ({ ...p, status: "finalizing", percentage: 99 }));

      // Compute SHA-256 checksum
      let checksumValue: string | undefined;
      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
        checksumValue = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      } catch {
        // If Web Crypto API not available, skip client-side checksum
        console.warn("Client-side checksum computation not available");
      }

      const finalizeRes = await fetch(`/api/transfers/${transferId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          parts: partETags.sort((a, b) => a.partNumber - b.partNumber),
          checksumValue,
        }),
      });

      if (!finalizeRes.ok) {
        const err = await finalizeRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to finalize upload");
      }

      const finalizeData = await finalizeRes.json();

      // Step 4: Done!
      try {
        localStorage.removeItem("videlink_active_transfer");
      } catch {}
      setProgress((p) => ({ ...p, status: "complete", percentage: 100 }));
      setResult({
        code,
        originalFilename: selectedFile.name,
        fileSize: selectedFile.size,
        expiresAt: finalizeData.expiresAt,
        integrityStatus: finalizeData.integrityStatus,
        checksumValue: finalizeData.checksumValue,
        downloadLimit,
      });
      setStep("complete");
    } catch (error) {
      console.error("Upload error:", error);
      setProgress((p) => ({
        ...p,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Upload failed",
      }));
    }
  }, [selectedFile, expirationHours, password, downloadLimit, senderMessage, allowPreview]);

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current = true;
  }, []);

  // ===== Copy Code =====
  const copyCode = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = result.code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }, [result]);

  const shareTransfer = useCallback(async () => {
    if (!result) return;
    const shareUrl = `${window.location.origin}/receive?code=${encodeURIComponent(result.code)}`;
    const shareData = {
      title: "VIDELINK Transfer",
      text: `I've shared a video with you. Use code: ${result.code}`,
      url: shareUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Share link copied to clipboard!");
    }
  }, [result]);

  // ===== Render =====
  return (
    <div className="min-h-[calc(100vh-4rem)] py-12">
      <div className="vl-container max-w-2xl">
        {/* Page Header */}
        <div className="text-center mb-10 vl-animate-in">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--vl-text-primary)" }}>
            Send a Video
          </h1>
          <p className="text-base" style={{ color: "var(--vl-text-secondary)" }}>
            Upload your video and share the transfer code.
          </p>
        </div>

        {/* ===== STEP: SELECT FILE ===== */}
        {step === "select" && (
          <div className="vl-animate-in">
            {activeTransferNotice && (
              <div className="mb-6 p-4 rounded-xl bg-[var(--vl-bg-secondary)] border border-[var(--vl-accent)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📁</span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--vl-text-primary)]">
                      Recent Transfer: {activeTransferNotice.filename}
                    </p>
                    <p className="text-xs text-[var(--vl-text-secondary)] font-mono">
                      Code: {activeTransferNotice.code}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/receive?code=${encodeURIComponent(activeTransferNotice.code)}`}
                    className="vl-btn-primary text-xs py-1.5 px-3"
                  >
                    View Transfer
                  </Link>
                  <button
                    onClick={() => {
                      try {
                        localStorage.removeItem("videlink_active_transfer");
                      } catch {}
                      setActiveTransferNotice(null);
                    }}
                    className="text-xs text-[var(--vl-text-tertiary)] hover:text-[var(--vl-text-primary)] px-2"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <div
              className={`vl-dropzone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              aria-label="Select a video file to upload"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_EXTENSIONS.join(",")}
                onChange={handleInputChange}
                className="hidden"
                aria-hidden="true"
              />
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "var(--vl-accent-subtle)", color: "var(--vl-accent)" }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold mb-1" style={{ color: "var(--vl-text-primary)" }}>
                    Drop your video here or click to browse
                  </p>
                  <p className="text-sm" style={{ color: "var(--vl-text-tertiary)" }}>
                    MP4, MOV, MKV, WebM and more · Up to {formatFileSize(MAX_FILE_SIZE_BYTES)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== STEP: SETTINGS ===== */}
        {step === "settings" && selectedFile && (
          <div className="vl-animate-in space-y-6">
            {/* Selected file card */}
            <div className="vl-card p-5">
              <div className="flex items-start gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--vl-accent-subtle)", color: "var(--vl-accent)" }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: "var(--vl-text-primary)" }}>
                    {selectedFile.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                    <span>{formatFileSize(selectedFile.size)}</span>
                    <span>·</span>
                    <span>{selectedFile.type || "Unknown type"}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setStep("select");
                  }}
                  className="p-2 rounded-lg hover:opacity-80 transition"
                  style={{ color: "var(--vl-text-tertiary)" }}
                  aria-label="Remove selected file"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Transfer Technology Mode */}
            <div className="vl-card p-5">
              <label className="font-semibold text-sm mb-1 block" style={{ color: "var(--vl-text-primary)" }}>
                Transfer Protocol
              </label>
              <p className="text-xs mb-3" style={{ color: "var(--vl-text-secondary)" }}>
                Choose how your video is delivered to the recipient.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTransferMode("p2p")}
                  className="p-4 rounded-xl text-left transition-all flex flex-col justify-between"
                  style={{
                    background: transferMode === "p2p" ? "rgba(99, 102, 241, 0.12)" : "var(--vl-bg-secondary)",
                    border: `1.5px solid ${transferMode === "p2p" ? "var(--vl-accent)" : "var(--vl-border-default)"}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm flex items-center gap-1.5" style={{ color: "var(--vl-accent)" }}>
                      ⚡ Direct P2P Stream
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                      UNLIMITED GB
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--vl-text-secondary)" }}>
                    Zero cloud storage required. Direct browser-to-browser encrypted streaming. Ideal for 5GB+ files.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTransferMode("cloud")}
                  className="p-4 rounded-xl text-left transition-all flex flex-col justify-between"
                  style={{
                    background: transferMode === "cloud" ? "rgba(99, 102, 241, 0.12)" : "var(--vl-bg-secondary)",
                    border: `1.5px solid ${transferMode === "cloud" ? "var(--vl-accent)" : "var(--vl-border-default)"}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm flex items-center gap-1.5" style={{ color: "var(--vl-accent)" }}>
                      ☁️ Cloud Storage
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400">
                      ASYNC
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--vl-text-secondary)" }}>
                    File is uploaded to cloud storage. Recipient can download anytime even when you are offline.
                  </p>
                </button>
              </div>
            </div>

            {/* Expiration */}
            <div className="vl-card p-5">
              <label className="font-semibold text-sm mb-3 block" style={{ color: "var(--vl-text-primary)" }}>
                Transfer Expiration
              </label>
              <div className="grid grid-cols-3 gap-3">
                {EXPIRATION_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setExpirationHours(preset.value)}
                    className="py-3 px-4 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: expirationHours === preset.value ? "var(--vl-accent)" : "var(--vl-bg-secondary)",
                      color: expirationHours === preset.value ? "white" : "var(--vl-text-secondary)",
                      border: `1px solid ${expirationHours === preset.value ? "var(--vl-accent)" : "var(--vl-border-default)"}`,
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="vl-card">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full p-5 flex items-center justify-between text-left"
              >
                <span className="font-semibold text-sm" style={{ color: "var(--vl-text-primary)" }}>
                  Advanced Settings
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--vl-text-tertiary)" }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showAdvanced && (
                <div className="px-5 pb-5 space-y-5 border-t" style={{ borderColor: "var(--vl-border-subtle)" }}>
                  {/* Password */}
                  <div className="pt-4">
                    <label htmlFor="password" className="text-sm font-medium mb-2 block" style={{ color: "var(--vl-text-primary)" }}>
                      Password Protection (optional)
                    </label>
                    <input
                      id="password"
                      type="password"
                      className="vl-input"
                      placeholder="Enter a password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </div>

                  {/* Download Limit */}
                  <div>
                    <label htmlFor="download-limit" className="text-sm font-medium mb-2 block" style={{ color: "var(--vl-text-primary)" }}>
                      Maximum Downloads (optional)
                    </label>
                    <input
                      id="download-limit"
                      type="number"
                      className="vl-input"
                      placeholder="Unlimited"
                      min={1}
                      max={1000}
                      value={downloadLimit ?? ""}
                      onChange={(e) =>
                        setDownloadLimit(e.target.value ? parseInt(e.target.value, 10) : undefined)
                      }
                    />
                  </div>

                  {/* Sender Message */}
                  <div>
                    <label htmlFor="message" className="text-sm font-medium mb-2 block" style={{ color: "var(--vl-text-primary)" }}>
                      Message for Recipient (optional)
                    </label>
                    <textarea
                      id="message"
                      className="vl-input resize-none"
                      rows={3}
                      placeholder="Add a note for the recipient..."
                      value={senderMessage}
                      onChange={(e) => setSenderMessage(e.target.value)}
                      maxLength={500}
                    />
                    <div className="text-xs mt-1 text-right" style={{ color: "var(--vl-text-tertiary)" }}>
                      {senderMessage.length}/500
                    </div>
                  </div>

                  {/* Preview Toggle */}
                  <div className="flex items-center justify-between">
                    <label htmlFor="allow-preview" className="text-sm font-medium" style={{ color: "var(--vl-text-primary)" }}>
                      Allow online preview
                    </label>
                    <button
                      id="allow-preview"
                      role="switch"
                      aria-checked={allowPreview}
                      onClick={() => setAllowPreview(!allowPreview)}
                      className="relative w-11 h-6 rounded-full transition-colors"
                      style={{
                        background: allowPreview ? "var(--vl-accent)" : "var(--vl-border-strong)",
                      }}
                    >
                      <span
                        className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform"
                        style={{
                          transform: allowPreview ? "translateX(20px)" : "translateX(0)",
                        }}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Upload Button */}
            <button onClick={startUpload} className="vl-btn-primary w-full py-4 text-base">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Start Upload
            </button>
          </div>
        )}

        {/* ===== STEP: UPLOADING ===== */}
        {step === "uploading" && (
          <div className="vl-animate-in">
            <div className="vl-card p-8">
              <div className="text-center mb-6">
                {progress.status === "finalizing" ? (
                  <>
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                      style={{ background: "var(--vl-accent-subtle)", color: "var(--vl-accent)" }}
                    >
                      <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                    </div>
                    <h2 className="font-bold text-xl mb-1" style={{ color: "var(--vl-text-primary)" }}>
                      Finalizing Upload...
                    </h2>
                    <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                      Verifying file integrity
                    </p>
                  </>
                ) : progress.status === "error" ? (
                  <>
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                      style={{ background: "var(--vl-error-subtle)", color: "var(--vl-error)" }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    </div>
                    <h2 className="font-bold text-xl mb-1" style={{ color: "var(--vl-text-primary)" }}>
                      Upload Failed
                    </h2>
                    <p className="text-sm" style={{ color: "var(--vl-error)" }}>
                      {progress.errorMessage}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="font-bold text-xl mb-1" style={{ color: "var(--vl-text-primary)" }}>
                      Uploading...
                    </h2>
                    <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                      {selectedFile?.name}
                    </p>
                  </>
                )}
              </div>

              {/* Progress Bar */}
              {progress.status !== "error" && (
                <>
                  <div className="vl-progress-bar mb-4">
                    <div className="vl-progress-fill" style={{ width: `${progress.percentage}%` }} />
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-lg font-bold" style={{ color: "var(--vl-accent)" }}>
                        {progress.percentage}%
                      </div>
                      <div className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                        Progress
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold" style={{ color: "var(--vl-text-primary)" }}>
                        {formatFileSize(progress.uploadedBytes)}
                      </div>
                      <div className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                        of {formatFileSize(progress.totalBytes)}
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold" style={{ color: "var(--vl-text-primary)" }}>
                        {formatSpeed(progress.speed)}
                      </div>
                      <div className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                        Speed
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold" style={{ color: "var(--vl-text-primary)" }}>
                        {progress.eta > 0 ? formatDuration(progress.eta) : "—"}
                      </div>
                      <div className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                        Remaining
                      </div>
                    </div>
                  </div>

                  {/* Parts indicator */}
                  <div className="mt-4 text-center text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                    Parts: {progress.partsCompleted} / {progress.totalParts}
                  </div>
                </>
              )}

              {/* Controls */}
              <div className="mt-6 flex justify-center gap-3">
                {progress.status === "uploading" && (
                  <button onClick={cancelUpload} className="vl-btn-secondary text-sm">
                    Cancel Upload
                  </button>
                )}
                {progress.status === "error" && (
                  <>
                    <button onClick={startUpload} className="vl-btn-primary text-sm">
                      Retry Upload
                    </button>
                    <button
                      onClick={() => {
                        setStep("settings");
                        setProgress({
                          totalBytes: 0, uploadedBytes: 0, percentage: 0,
                          speed: 0, eta: 0, partsCompleted: 0, totalParts: 0, status: "uploading",
                        });
                      }}
                      className="vl-btn-secondary text-sm"
                    >
                      Back to Settings
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== STEP: COMPLETE ===== */}
        {step === "complete" && result && (
          <div className="vl-animate-in">
            <div className="vl-card p-8">
              {/* Success Icon */}
              <div className="text-center mb-6">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: "var(--vl-success-subtle)", color: "var(--vl-success)" }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="font-bold text-xl mb-1" style={{ color: "var(--vl-text-primary)" }}>
                  Your video is ready to share
                </h2>
                <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                  Share the transfer code below with your recipient.
                </p>
              </div>

              {/* Transfer Code */}
              <div
                className="rounded-xl p-6 text-center mb-6"
                style={{ background: "var(--vl-bg-secondary)", border: "1px solid var(--vl-border-default)" }}
              >
                <div className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: "var(--vl-text-tertiary)" }}>
                  Transfer Code
                </div>
                <div className="text-3xl sm:text-4xl font-mono font-bold tracking-widest mb-4" style={{ color: "var(--vl-accent)" }}>
                  {result.code}
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={copyCode} className="vl-btn-primary text-sm py-2.5 px-5">
                    {codeCopied ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy Code
                      </>
                    )}
                  </button>
                  <button onClick={shareTransfer} className="vl-btn-secondary text-sm py-2.5 px-5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                    Share
                  </button>
                  {qrDataUrl && (
                    <button
                      onClick={() => setShowQr(!showQr)}
                      className="vl-btn-secondary text-sm py-2.5 px-5"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </svg>
                      {showQr ? "Hide QR" : "QR Code"}
                    </button>
                  )}
                </div>

                {/* QR Code Container */}
                {showQr && qrDataUrl && (
                  <div className="mt-6 pt-6 border-t border-[var(--vl-border-subtle)] flex flex-col items-center animate-in fade-in duration-300">
                    <div className="p-3 bg-white rounded-2xl shadow-xl inline-block mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrDataUrl}
                        alt={`QR code for transfer ${result.code}`}
                        className="w-48 h-48 rounded-lg"
                      />
                    </div>
                    <p className="text-xs text-[var(--vl-text-secondary)] mb-2">
                      Scan with your phone to open and receive immediately
                    </p>
                    <a
                      href={qrDataUrl}
                      download={`videlink-qr-${result.code}.png`}
                      className="text-xs text-[var(--vl-accent)] hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      Download QR Image
                    </a>
                  </div>
                )}
              </div>

              {/* P2P Live Streaming Status Card */}
              {transferMode === "p2p" && (
                <div
                  className="rounded-2xl p-5 mb-6 border animate-in fade-in duration-300"
                  style={{
                    background:
                      p2pStatus === "completed"
                        ? "rgba(16, 185, 129, 0.08)"
                        : p2pStatus === "streaming"
                        ? "rgba(99, 102, 241, 0.08)"
                        : "var(--vl-bg-secondary)",
                    borderColor:
                      p2pStatus === "completed"
                        ? "var(--vl-success)"
                        : p2pStatus === "streaming"
                        ? "var(--vl-accent)"
                        : "var(--vl-border-default)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-3 w-3">
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            p2pStatus === "completed"
                              ? "bg-emerald-400"
                              : p2pStatus === "streaming"
                              ? "bg-indigo-400"
                              : "bg-amber-400"
                          }`}
                        />
                        <span
                          className={`relative inline-flex rounded-full h-3 w-3 ${
                            p2pStatus === "completed"
                              ? "bg-emerald-500"
                              : p2pStatus === "streaming"
                              ? "bg-indigo-500"
                              : "bg-amber-500"
                          }`}
                        />
                      </span>
                      <span className="font-semibold text-sm" style={{ color: "var(--vl-text-primary)" }}>
                        {p2pStatus === "waiting_for_peer" && "Waiting for Recipient..."}
                        {p2pStatus === "connecting" && "Establishing Direct Stream..."}
                        {p2pStatus === "streaming" && "Streaming File Directly to Recipient"}
                        {p2pStatus === "completed" && "P2P Stream Complete!"}
                        {p2pStatus === "failed" && "P2P Stream Interrupted"}
                      </span>
                    </div>

                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--vl-accent-subtle)] text-[var(--vl-accent)] font-semibold">
                      WebRTC P2P
                    </span>
                  </div>

                  <p className="text-xs mb-3" style={{ color: "var(--vl-text-secondary)" }}>
                    {p2pStatusMsg}
                  </p>

                  {p2pStatus === "streaming" && (
                    <div className="space-y-2">
                      <div className="vl-progress-bar">
                        <div className="vl-progress-fill" style={{ width: `${p2pProgress.percentage}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono" style={{ color: "var(--vl-text-secondary)" }}>
                        <span>
                          {formatFileSize(p2pProgress.bytesTransferred)} / {formatFileSize(p2pProgress.totalBytes)} ({p2pProgress.percentage}%)
                        </span>
                        <span>
                          ⚡ {formatSpeed(p2pProgress.speed)} · {p2pProgress.eta > 0 ? `${Math.round(p2pProgress.eta)}s remaining` : "finishing"}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-[var(--vl-border-subtle)] flex items-center gap-2 text-[11px]" style={{ color: "var(--vl-text-tertiary)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>Keep this tab open while sending. File streams directly from this device to the recipient.</span>
                  </div>
                </div>
              )}

              {/* Transfer Passport */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm" style={{ color: "var(--vl-text-primary)" }}>
                  Transfer Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="vl-card p-3">
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Filename</div>
                    <div className="font-medium truncate" style={{ color: "var(--vl-text-primary)" }}>{result.originalFilename}</div>
                  </div>
                  <div className="vl-card p-3">
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Size</div>
                    <div className="font-medium" style={{ color: "var(--vl-text-primary)" }}>{formatFileSize(result.fileSize)}</div>
                  </div>
                  <div className="vl-card p-3">
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Expires</div>
                    <div className="font-medium" style={{ color: "var(--vl-text-primary)" }}>
                      {new Date(result.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="vl-card p-3">
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Integrity</div>
                    <div className="font-medium flex items-center gap-1.5">
                      {result.integrityStatus === "verified" ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--vl-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span style={{ color: "var(--vl-success)" }}>Verified</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--vl-warning)" }}>Pending</span>
                      )}
                    </div>
                  </div>
                  {result.downloadLimit && (
                    <div className="vl-card p-3">
                      <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Download Limit</div>
                      <div className="font-medium" style={{ color: "var(--vl-text-primary)" }}>{result.downloadLimit} downloads</div>
                    </div>
                  )}
                  {result.checksumValue && (
                    <div className="vl-card p-3 col-span-2">
                      <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>SHA-256 Checksum</div>
                      <div className="font-mono text-xs truncate" style={{ color: "var(--vl-text-secondary)" }}>{result.checksumValue}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Warning */}
              <div
                className="mt-6 p-4 rounded-lg text-sm"
                style={{
                  background: "var(--vl-warning-subtle)",
                  border: "1px solid var(--vl-warning)",
                  borderColor: "rgba(245, 158, 11, 0.2)",
                  color: "var(--vl-text-secondary)",
                }}
              >
                <strong>Important:</strong> Anyone who obtains this code may be able to access your transfer
                {password ? " (password protection is enabled)." : " unless additional protection is enabled."}
              </div>

              {/* New Transfer */}
              <div className="mt-6 text-center">
                <Link href="/send" className="vl-btn-secondary text-sm" onClick={() => window.location.reload()}>
                  Send Another Video
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
