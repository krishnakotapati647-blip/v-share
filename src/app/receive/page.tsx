"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  formatFileSize,
  normalizeTransferCode,
  TRANSFER_CODE_REGEX,
  type TransferPublicInfo,
} from "@/lib/types";

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

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3">
                {transfer.allowPreview && isPlayableInBrowser(transfer.contentType) && (
                  <button
                    onClick={() => {
                      // Open video player (we'll implement inline)
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
                    disabled={downloading}
                  >
                    {downloading ? (
                      <>
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56" />
                        </svg>
                        Preparing...
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
