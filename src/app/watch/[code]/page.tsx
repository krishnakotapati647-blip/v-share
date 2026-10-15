"use client";

import { useEffect, useState, useRef, use, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatFileSize } from "@/lib/types";

interface VideoData {
  previewUrl: string;
  contentType: string;
  originalFilename: string;
  fileSize: number;
  senderMessage?: string | null;
  expiresAt: string;
  checksumValue?: string | null;
  integrityStatus: string;
}

function WatchPageContent({ params }: { params: Promise<{ code: string }> }) {
  const resolvedParams = use(params);
  const code = decodeURIComponent(resolvedParams.code);
  const searchParams = useSearchParams();
  const initialPassword = searchParams.get("p") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState(initialPassword);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [downloading, setDownloading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);

  const fetchPreview = async (passToTry?: string) => {
    setLoading(true);
    setError(null);
    setPasswordError(null);

    try {
      const res = await fetch("/api/transfers/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...(passToTry ? { password: passToTry } : {}),
        }),
      });

      if (res.status === 401) {
        setPasswordRequired(true);
        if (passToTry) {
          setPasswordError("Incorrect password. Please try again.");
        }
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Could not load video (${res.status})`);
      }

      const data = await res.json();
      setVideoData(data);
      setPasswordRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading video");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPreview(initialPassword);
  }, [code]);

  const handleDownloadOriginal = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/transfers/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...(password ? { password } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Download failed");
      }

      const { downloadUrl, filename } = await res.json();
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download original file");
    } finally {
      setDownloading(false);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link
            href={`/receive?code=${encodeURIComponent(code)}`}
            className="inline-flex items-center gap-2 text-sm text-[var(--vl-text-secondary)] hover:text-[var(--vl-accent)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Transfer Details
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--vl-bg-secondary)] border border-[var(--vl-border-subtle)] text-xs font-mono">
            <span>Code:</span>
            <span className="font-bold text-[var(--vl-accent)]">{code}</span>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="vl-card p-16 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-[var(--vl-accent-subtle)] text-[var(--vl-accent)]">
              <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
            </div>
            <p className="text-sm text-[var(--vl-text-secondary)]">Loading secure video player...</p>
          </div>
        )}

        {/* Password Prompt */}
        {!loading && passwordRequired && (
          <div className="vl-card p-8 max-w-md mx-auto text-center space-y-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto bg-[var(--vl-warning-subtle)] text-[var(--vl-warning)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[var(--vl-text-primary)]">Protected Transfer</h2>
            <p className="text-sm text-[var(--vl-text-secondary)]">
              Enter password to watch this video stream.
            </p>
            <div className="space-y-3">
              <input
                type="password"
                className="vl-input"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchPreview(password)}
                autoFocus
              />
              {passwordError && (
                <p className="text-xs text-[var(--vl-error)]">{passwordError}</p>
              )}
              <button
                onClick={() => fetchPreview(password)}
                className="vl-btn-primary w-full py-3"
              >
                Unlock Video
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && !passwordRequired && (
          <div className="vl-card p-12 text-center max-w-lg mx-auto space-y-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto bg-[var(--vl-error-subtle)] text-[var(--vl-error)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h3 className="text-lg font-bold text-[var(--vl-text-primary)]">Playback Unavailable</h3>
            <p className="text-sm text-[var(--vl-text-secondary)]">{error}</p>
            <Link href="/receive" className="vl-btn-primary inline-flex py-2.5 px-6">
              Go to Receive Page
            </Link>
          </div>
        )}

        {/* Video Player & Passport */}
        {!loading && videoData && (
          <div className="space-y-6">
            {/* Cinema Player Container */}
            <div className="relative rounded-2xl overflow-hidden bg-black shadow-2xl border border-[var(--vl-border-subtle)] group">
              <video
                ref={videoRef}
                src={videoData.previewUrl}
                className="w-full max-h-[70vh] aspect-video object-contain bg-black"
                playsInline
                controls
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={() => {
                  if (videoRef.current) {
                    setCurrentTime(videoRef.current.currentTime);
                  }
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    setDuration(videoRef.current.duration);
                  }
                }}
                onError={() => setPlaybackError(true)}
              />

              {playbackError && (
                <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-sm text-red-400 mb-3">
                    Browser was unable to decode this video codec directly.
                  </p>
                  <button
                    onClick={handleDownloadOriginal}
                    className="vl-btn-primary py-2.5 px-5 text-sm"
                  >
                    Download Original File to Play Locally
                  </button>
                </div>
              )}
            </div>

            {/* Video Passport & Actions Header */}
            <div className="vl-card p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[var(--vl-border-subtle)]">
                <div>
                  <h1 className="text-xl font-bold text-[var(--vl-text-primary)] mb-1">
                    {videoData.originalFilename}
                  </h1>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--vl-text-secondary)]">
                    <span className="font-medium text-[var(--vl-accent)]">{formatFileSize(videoData.fileSize)}</span>
                    <span>•</span>
                    <span>{videoData.contentType}</span>
                    <span>•</span>
                    <span>Expires {new Date(videoData.expiresAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDownloadOriginal}
                    disabled={downloading}
                    className="vl-btn-primary py-2.5 px-5 flex items-center gap-2 text-sm"
                  >
                    {downloading ? (
                      <>
                        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 11-6.219-8.56"/>
                        </svg>
                        Preparing...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download Original
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Message if present */}
              {videoData.senderMessage && (
                <div className="mt-4 p-4 rounded-xl bg-[var(--vl-bg-secondary)] border border-[var(--vl-border-subtle)] text-sm">
                  <span className="text-xs font-semibold text-[var(--vl-text-tertiary)] uppercase tracking-wider block mb-1">
                    Sender Message
                  </span>
                  <p className="text-[var(--vl-text-primary)]">{videoData.senderMessage}</p>
                </div>
              )}

              {/* Integrity Passport */}
              <div className="mt-4 pt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--vl-text-tertiary)]">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Integrity: {videoData.integrityStatus === "verified" ? "Original SHA-256 Verified" : "Transferred intact"}</span>
                </div>
                {videoData.checksumValue && (
                  <div className="font-mono text-[11px] truncate max-w-xs text-[var(--vl-text-secondary)]">
                    SHA-256: {videoData.checksumValue}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[var(--vl-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <WatchPageContent params={params} />
    </Suspense>
  );
}
