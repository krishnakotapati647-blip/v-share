"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  formatFileSize,
  formatSpeed,
  normalizeTransferCode,
  TRANSFER_CODE_REGEX,
  type TransferPublicInfo,
} from "@/lib/types";
import { P2PReceiverSession, type P2PProgress, type P2PStatus } from "@/lib/webrtc";

type ReceiveStep = "input" | "loading" | "password" | "details" | "error";

function ReceivePageContent() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<ReceiveStep>("input");
  const [codeInput, setCodeInput] = useState("");
  const [transfer, setTransfer] = useState<TransferPublicInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [events, setEvents] = useState<{ id: string; eventType: string; createdAt: string; metadata?: any }[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showPassport, setShowPassport] = useState(false);

  // P2P Streaming states
  const [p2pStatus, setP2pStatus] = useState<P2PStatus | null>(null);
  const [p2pStatusMsg, setP2pStatusMsg] = useState<string>("");
  const [manifestFiles, setManifestFiles] = useState<{ name: string; size: number; mimeType: string }[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<{ filename: string; blob: Blob; url: string; size: number }[]>([]);
  const [p2pProgress, setP2pProgress] = useState<P2PProgress>({
    bytesTransferred: 0,
    totalBytes: 0,
    percentage: 0,
    speed: 0,
    eta: 0,
  });
  const [p2pComplete, setP2pComplete] = useState(false);
  const p2pReceiverRef = useRef<P2PReceiverSession | null>(null);

  useEffect(() => {
    return () => {
      p2pReceiverRef.current?.destroy();
    };
  }, []);

  // Pre-fill code from URL query
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) {
      setCodeInput(normalizeTransferCode(urlCode));
    }
  }, [searchParams]);

  // ===== Format code as user types =====
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");

    // Auto-format: add dashes
    const chars = raw.replace(/-/g, "");
    if (chars.length <= 2) {
      raw = chars;
    } else if (chars.length <= 6) {
      raw = chars.slice(0, 2) + "-" + chars.slice(2);
    } else {
      raw = chars.slice(0, 2) + "-" + chars.slice(2, 6) + "-" + chars.slice(6, 10);
    }

    setCodeInput(raw);
  }, []);

  // ===== Lookup Transfer =====
  const lookupTransfer = useCallback(
    async (passwordAttempt?: string) => {
      const code = normalizeTransferCode(codeInput);
      if (!TRANSFER_CODE_REGEX.test(code)) {
        setError("Please enter a valid transfer code (e.g., VL-7K9P-2M4X).");
        setStep("error");
        return;
      }

      setStep("loading");
      setError(null);

      try {
        const res = await fetch("/api/transfers/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            ...(passwordAttempt ? { password: passwordAttempt } : {}),
          }),
        });

        if (res.status === 401) {
          // Password required
          const data = await res.json().catch(() => ({}));
          if (data.passwordRequired) {
            setStep("password");
            if (passwordAttempt) {
              setPasswordError("Incorrect password. Please try again.");
            }
            return;
          }
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Transfer not found (${res.status})`);
        }

        const data = await res.json();
        setTransfer(data.transfer);
        setStep("details");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setStep("error");
      }
    },
    [codeInput]
  );

  // ===== Password Submit =====
  const submitPassword = useCallback(() => {
    if (!password.trim()) return;
    setPasswordError(null);
    lookupTransfer(password);
  }, [password, lookupTransfer]);

  // ===== Download Original =====
  const downloadOriginal = useCallback(async () => {
    if (!transfer) return;

    if (transfer.isP2P) {
      if (!transfer.id) {
        alert("Transfer session ID is missing.");
        return;
      }
      setP2pStatus("initializing");
      setP2pStatusMsg("Connecting directly to sender's browser...");

      const p2p = new P2PReceiverSession(transfer.id);
      p2pReceiverRef.current = p2p;

      p2p.onStatusChange = (status, msg) => {
        setP2pStatus(status);
        if (msg) setP2pStatusMsg(msg);
      };

      p2p.onProgress = (prog) => {
        setP2pProgress(prog);
      };

      p2p.onManifestReceived = (files) => {
        setManifestFiles(files);
      };

      p2p.onFileReceived = (blob, filename, fileIndex, totalFiles) => {
        const url = URL.createObjectURL(blob);
        setReceivedFiles((prev) => [...prev, { filename, blob, url, size: blob.size }]);
        if (fileIndex + 1 === totalFiles) {
          setP2pComplete(true);
        }
      };

      p2p.onBatchComplete = () => {
        setP2pComplete(true);
      };

      p2p.start();
      return;
    }

    setDownloading(true);
    try {
      const res = await fetch("/api/transfers/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: transfer.code,
          ...(password ? { password } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to get download URL");
      }

      const { downloadUrl, filename } = await res.json();

      // Trigger download
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [transfer, password]);

  // ===== Load Transfer Passport Audit Events =====
  const loadPassportEvents = useCallback(async () => {
    if (!transfer) return;
    if (showPassport) {
      setShowPassport(false);
      return;
    }
    setLoadingEvents(true);
    setShowPassport(true);
    try {
      const res = await fetch("/api/transfers/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: transfer.code, ...(password ? { password } : {}) }),
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (e) {
      console.error("Failed to load events:", e);
    } finally {
      setLoadingEvents(false);
    }
  }, [transfer, password, showPassport]);

  return (
    <div className="min-h-[calc(100vh-4rem)] py-12">
      <div className="vl-container max-w-xl">
        {/* Page Header */}
        <div className="text-center mb-10 vl-animate-in">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--vl-text-primary)" }}>
            Receive a Video
          </h1>
          <p className="text-base" style={{ color: "var(--vl-text-secondary)" }}>
            Enter your transfer code to access the video.
          </p>
        </div>

        {/* ===== STEP: CODE INPUT ===== */}
        {step === "input" && (
          <div className="vl-animate-in">
            <div className="vl-card p-8">
              <div className="text-center mb-6">
                <h2 className="font-semibold text-lg mb-1" style={{ color: "var(--vl-text-primary)" }}>
                  Have a transfer code?
                </h2>
                <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                  Enter the code to access your video.
                </p>
              </div>

              <div className="space-y-4">
                <input
                  type="text"
                  className="vl-input text-center text-xl font-mono tracking-widest"
                  placeholder="VL-XXXX-XXXX"
                  value={codeInput}
                  onChange={handleCodeChange}
                  maxLength={12}
                  autoFocus
                  aria-label="Transfer code"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") lookupTransfer();
                  }}
                />

                <button
                  onClick={() => lookupTransfer()}
                  className="vl-btn-primary w-full py-3.5"
                  disabled={codeInput.length < 10}
                >
                  Access Transfer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== STEP: LOADING ===== */}
        {step === "loading" && (
          <div className="vl-animate-in">
            <div className="vl-card p-8 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "var(--vl-accent-subtle)", color: "var(--vl-accent)" }}
              >
                <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              </div>
              <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                Looking up your transfer...
              </p>
            </div>
          </div>
        )}

        {/* ===== STEP: PASSWORD ===== */}
        {step === "password" && (
          <div className="vl-animate-in">
            <div className="vl-card p-8">
              <div className="text-center mb-6">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ background: "var(--vl-warning-subtle)", color: "var(--vl-warning)" }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h2 className="font-semibold text-lg mb-1" style={{ color: "var(--vl-text-primary)" }}>
                  Password Required
                </h2>
                <p className="text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                  This transfer is password-protected.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <input
                    type="password"
                    className="vl-input"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitPassword();
                    }}
                  />
                  {passwordError && (
                    <p className="text-sm mt-2" style={{ color: "var(--vl-error)" }}>
                      {passwordError}
                    </p>
                  )}
                </div>
                <button onClick={submitPassword} className="vl-btn-primary w-full py-3">
                  Unlock Transfer
                </button>
                <button
                  onClick={() => {
                    setStep("input");
                    setPassword("");
                    setPasswordError(null);
                  }}
                  className="vl-btn-secondary w-full py-3 text-sm"
                >
                  Try a Different Code
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== STEP: TRANSFER DETAILS ===== */}
        {step === "details" && transfer && (
          <div className="vl-animate-in space-y-6">
            {/* Transfer Info Card */}
            <div className="vl-card p-6">
              <div className="flex items-start gap-4 mb-6">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--vl-accent-subtle)", color: "var(--vl-accent)" }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-lg truncate" style={{ color: "var(--vl-text-primary)" }}>
                    {transfer.originalFilename}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-sm" style={{ color: "var(--vl-text-secondary)" }}>
                    <span>{formatFileSize(transfer.fileSize)}</span>
                    <span>·</span>
                    <span>{transfer.contentType}</span>
                  </div>
                </div>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3 text-sm mb-6">
                <div className="p-3 rounded-lg" style={{ background: "var(--vl-bg-secondary)" }}>
                  <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Expires</div>
                  <div className="font-medium" style={{ color: "var(--vl-text-primary)" }}>
                    {new Date(transfer.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div className="p-3 rounded-lg" style={{ background: "var(--vl-bg-secondary)" }}>
                  <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Integrity</div>
                  <div className="font-medium flex items-center gap-1.5">
                    {transfer.integrityStatus === "verified" ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--vl-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span style={{ color: "var(--vl-success)" }}>Original file verified</span>
                      </>
                    ) : (
                      <span style={{ color: "var(--vl-warning)" }}>Pending verification</span>
                    )}
                  </div>
                </div>
                {transfer.downloadLimit && (
                  <div className="p-3 rounded-lg" style={{ background: "var(--vl-bg-secondary)" }}>
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>Downloads</div>
                    <div className="font-medium" style={{ color: "var(--vl-text-primary)" }}>
                      {transfer.downloadCount} / {transfer.downloadLimit}
                    </div>
                  </div>
                )}
                {transfer.checksumAlgorithm && transfer.checksumValue && (
                  <div className="p-3 rounded-lg col-span-2" style={{ background: "var(--vl-bg-secondary)" }}>
                    <div className="text-xs mb-0.5" style={{ color: "var(--vl-text-tertiary)" }}>{transfer.checksumAlgorithm}</div>
                    <div className="font-mono text-xs truncate" style={{ color: "var(--vl-text-secondary)" }}>
                      {transfer.checksumValue}
                    </div>
                  </div>
                )}
              </div>

              {/* Sender Message */}
              {transfer.senderMessage && (
                <div
                  className="p-4 rounded-lg mb-6"
                  style={{ background: "var(--vl-bg-secondary)", border: "1px solid var(--vl-border-subtle)" }}
                >
                  <div className="text-xs font-medium mb-1" style={{ color: "var(--vl-text-tertiary)" }}>
                    Message from sender
                  </div>
                  <p className="text-sm" style={{ color: "var(--vl-text-primary)" }}>
                    {transfer.senderMessage}
                  </p>
                </div>
              )}

              {/* P2P Live Streaming Progress Card */}
              {p2pStatus && (
                <>
                  {p2pStatus === "cancelled" ? (
                    <div
                      className="rounded-2xl p-5 mb-6 border animate-in fade-in duration-300"
                      style={{
                        background: "rgba(239, 68, 68, 0.08)",
                        borderColor: "var(--vl-error)",
                      }}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span className="w-8 h-8 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center font-bold text-sm">
                          ✕
                        </span>
                        <div>
                          <h4 className="font-semibold text-sm" style={{ color: "var(--vl-text-primary)" }}>
                            Transfer Cancelled
                          </h4>
                          <p className="text-xs" style={{ color: "var(--vl-error)" }}>
                            {p2pStatusMsg || "The transfer has been cancelled."}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            p2pReceiverRef.current?.destroy();
                            setP2pStatus(null);
                            setP2pComplete(false);
                            setReceivedFiles([]);
                          }}
                          className="vl-btn-secondary text-xs py-2 px-4"
                        >
                          Try Again
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="rounded-2xl p-5 mb-6 border animate-in fade-in duration-300"
                      style={{
                        background:
                          p2pComplete
                            ? "rgba(16, 185, 129, 0.08)"
                            : p2pStatus === "streaming"
                            ? "rgba(99, 102, 241, 0.08)"
                            : "var(--vl-bg-secondary)",
                        borderColor:
                          p2pComplete
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
                                p2pComplete
                                  ? "bg-emerald-400"
                                  : p2pStatus === "streaming"
                                  ? "bg-indigo-400"
                                  : "bg-amber-400"
                              }`}
                            />
                            <span
                              className={`relative inline-flex rounded-full h-3 w-3 ${
                                p2pComplete
                                  ? "bg-emerald-500"
                                  : p2pStatus === "streaming"
                                  ? "bg-indigo-500"
                                  : "bg-amber-500"
                              }`}
                            />
                          </span>
                          <span className="font-semibold text-sm" style={{ color: "var(--vl-text-primary)" }}>
                            {p2pComplete
                              ? "Download Complete!"
                              : p2pStatus === "streaming"
                              ? "Streaming Video Directly from Sender..."
                              : p2pStatusMsg || "Connecting to Sender..."}
                          </span>
                        </div>

                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--vl-accent-subtle)] text-[var(--vl-accent)] font-semibold">
                          WebRTC P2P
                        </span>
                      </div>

                      {/* Current file in batch indicator */}
                      {p2pStatus === "streaming" && p2pProgress.totalFiles && p2pProgress.totalFiles > 1 && (
                        <div className="mt-3 mb-2 p-2.5 rounded-xl bg-[var(--vl-bg-primary)] border border-[var(--vl-border-subtle)]">
                          <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
                            <span className="truncate mr-2" style={{ color: "var(--vl-text-primary)" }}>
                              Video {(p2pProgress.currentFileIndex ?? 0) + 1} of {p2pProgress.totalFiles}:{" "}
                              <span style={{ color: "var(--vl-accent)" }}>{p2pProgress.currentFileName}</span>
                            </span>
                            <span className="font-mono text-[var(--vl-accent)]">
                              {p2pProgress.currentFilePercentage ?? 0}%
                            </span>
                          </div>
                          <div className="w-full bg-[var(--vl-bg-secondary)] h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-200"
                              style={{
                                width: `${p2pProgress.currentFilePercentage ?? 0}%`,
                                background: "var(--vl-accent)",
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Overall Progress Bar */}
                      {p2pStatus === "streaming" && (
                        <div className="space-y-2 mt-3">
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

                      {/* Cancel Transfer Button */}
                      {(p2pStatus === "initializing" || p2pStatus === "connecting" || p2pStatus === "streaming") && (
                        <div className="mt-3 pt-3 border-t border-[var(--vl-border-subtle)] flex items-center justify-between">
                          <span className="text-[11px]" style={{ color: "var(--vl-text-tertiary)" }}>
                            Keep tab open during transfer
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm("Are you sure you want to cancel receiving this transfer?")) {
                                p2pReceiverRef.current?.cancel("receiver");
                              }
                            }}
                            className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 inline-flex items-center gap-1.5 py-1 px-2.5 rounded-lg border border-red-500/20 transition"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Cancel Transfer
                          </button>
                        </div>
                      )}

                      {p2pComplete && (
                        <div className="mt-3">
                          <p className="text-xs mb-3" style={{ color: "var(--vl-success)" }}>
                            🎉 All files saved directly to your computer in 100% original quality!
                          </p>
                          {receivedFiles.length > 0 && (
                            <div className="space-y-2 mt-2 pt-2 border-t border-[var(--vl-border-subtle)]">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--vl-text-tertiary)] block">
                                Received Videos ({receivedFiles.length})
                              </span>
                              {receivedFiles.map((rf, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--vl-bg-primary)] border border-[var(--vl-border-subtle)] text-xs"
                                >
                                  <span className="font-medium truncate mr-2" style={{ color: "var(--vl-text-primary)" }}>
                                    {rf.filename} ({formatFileSize(rf.size)})
                                  </span>
                                  <a
                                    href={rf.url}
                                    download={rf.filename}
                                    className="text-[var(--vl-accent)] hover:underline flex-shrink-0 font-medium"
                                  >
                                    Download Again
                                  </a>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3">
                {transfer.allowPreview && !transfer.isP2P && isPlayableInBrowser(transfer.contentType) && (
                  <button
                    onClick={() => {
                      // Open video player
                      window.open(`/watch/${encodeURIComponent(transfer.code)}${password ? `?p=${encodeURIComponent(password)}` : ""}`, "_blank");
                    }}
                    className="vl-btn-secondary flex-1 py-3.5"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Watch Online
                  </button>
                )}

                {transfer.allowOriginalDownload && (
                  <button
                    onClick={downloadOriginal}
                    className="vl-btn-primary flex-1 py-3.5"
                    disabled={downloading || p2pStatus === "streaming" || p2pStatus === "initializing" || p2pComplete}
                  >
                    {p2pStatus === "streaming" ? (
                      <>
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                        ⚡ Streaming ({p2pProgress.percentage}%)
                      </>
                    ) : p2pStatus === "initializing" || p2pStatus === "connecting" ? (
                      <>
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                        Connecting to Sender...
                      </>
                    ) : p2pComplete ? (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Downloaded Successfully
                      </>
                    ) : downloading ? (
                      <>
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                        Preparing...
                      </>
                    ) : transfer.isP2P ? (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        Start Direct P2P Download
                      </>
                    ) : (
                      <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download Original
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Passport & Audit Trail Button */}
              <div className="mt-4 pt-4 border-t border-[var(--vl-border-subtle)] flex items-center justify-between">
                <button
                  onClick={loadPassportEvents}
                  className="text-xs font-medium text-[var(--vl-accent)] hover:underline inline-flex items-center gap-1.5"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {showPassport ? "Hide Transfer Passport" : "View Transfer Passport & Audit Trail"}
                </button>
                <span className="text-[11px] text-[var(--vl-text-tertiary)]">Cryptographically Verified</span>
              </div>

              {/* Passport Timeline */}
              {showPassport && (
                <div className="mt-4 p-4 rounded-xl bg-[var(--vl-bg-secondary)] border border-[var(--vl-border-subtle)] animate-in fade-in duration-200">
                  <div className="text-xs font-semibold text-[var(--vl-text-tertiary)] uppercase tracking-wider mb-3 flex items-center justify-between">
                    <span>Audit Trail Passport</span>
                    {loadingEvents && <span className="animate-spin text-xs">⏳</span>}
                  </div>
                  {events && events.length > 0 ? (
                    <div className="space-y-3">
                      {events.map((ev, idx) => {
                        const eventLabels: Record<string, { label: string; icon: string }> = {
                          upload_initiated: { label: "Transfer Initiated", icon: "📤" },
                          upload_completed: { label: "Upload Completed & Verified", icon: "📦" },
                          transfer_viewed: { label: "Transfer Accessed", icon: "👁️" },
                          download_authorized: { label: "Download Authorized", icon: "⬇️" },
                          transfer_expired: { label: "Transfer Expired", icon: "⏳" },
                        };
                        const info = eventLabels[ev.eventType] || { label: ev.eventType, icon: "📋" };
                        return (
                          <div key={ev.id || idx} className="flex items-start gap-3 text-xs">
                            <span className="text-base leading-none">{info.icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[var(--vl-text-primary)]">{info.label}</p>
                              <p className="text-[11px] text-[var(--vl-text-tertiary)]">
                                {new Date(ev.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : !loadingEvents ? (
                    <p className="text-xs text-[var(--vl-text-tertiary)]">No audit records found.</p>
                  ) : null}
                </div>
              )}

              {!isPlayableInBrowser(transfer.contentType) && transfer.allowPreview && (
                <p className="text-xs mt-4 text-center" style={{ color: "var(--vl-text-tertiary)" }}>
                  Online preview is not available for this format ({transfer.contentType}).
                  You can still download the original file.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ===== STEP: ERROR ===== */}
        {step === "error" && (
          <div className="vl-animate-in">
            <div className="vl-card p-8 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "var(--vl-error-subtle)", color: "var(--vl-error)" }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h2 className="font-bold text-lg mb-2" style={{ color: "var(--vl-text-primary)" }}>
                Transfer Not Accessible
              </h2>
              <p className="text-sm mb-6" style={{ color: "var(--vl-text-secondary)" }}>
                {error}
              </p>
              <button
                onClick={() => {
                  setStep("input");
                  setError(null);
                }}
                className="vl-btn-primary"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper: check if a content type can be played in most browsers
function isPlayableInBrowser(contentType: string): boolean {
  const playable = ["video/mp4", "video/webm", "video/ogg"];
  return playable.includes(contentType.toLowerCase());
}

export default function ReceivePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[var(--vl-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ReceivePageContent />
    </Suspense>
  );
}
