"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <>
      {/* ===== HERO ===== */}
      <section className="py-20 md:py-32" style={{ background: "var(--vl-bg-primary)" }}>
        <div className="vl-container text-center">
          <div className="vl-animate-in max-w-3xl mx-auto">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-8"
              style={{
                background: "var(--vl-accent-subtle)",
                color: "var(--vl-accent-text)",
                border: "1px solid var(--vl-accent)",
                borderColor: "rgba(99, 102, 241, 0.2)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Secure Video Transfers
            </div>

            {/* Headline */}
            <h1
              className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6"
              style={{ color: "var(--vl-text-primary)" }}
            >
              Your Videos. Your Quality.{" "}
              <span className="vl-gradient-text">Your Distance.</span>
            </h1>

            {/* Subheadline */}
            <p
              className="text-lg md:text-xl leading-relaxed mb-10 max-w-2xl mx-auto"
              style={{ color: "var(--vl-text-secondary)" }}
            >
              Send large videos using a simple, secure code. Preserve your original files
              and share them across any distance.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/send" className="vl-btn-primary text-base py-3.5 px-8 w-full sm:w-auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Send a Video
              </Link>
              <Link href="/receive" className="vl-btn-secondary text-base py-3.5 px-8 w-full sm:w-auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Receive a Video
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CORE BENEFITS ===== */}
      <section className="py-20" style={{ background: "var(--vl-bg-secondary)" }}>
        <div className="vl-container">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: "var(--vl-text-primary)" }}>
              Built for large video files
            </h2>
            <p className="text-base" style={{ color: "var(--vl-text-secondary)" }}>
              Three things that matter when sharing videos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Benefit 1 */}
            <div className="vl-card p-8">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{ background: "var(--vl-accent-subtle)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--vl-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--vl-text-primary)" }}>
                Original File Preservation
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-secondary)" }}>
                Your original file stays unchanged. No compression, no transcoding, no quality loss.
                Download exactly what was uploaded.
              </p>
            </div>

            {/* Benefit 2 */}
            <div className="vl-card p-8">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{ background: "var(--vl-success-subtle)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--vl-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--vl-text-primary)" }}>
                Reliable Transfers
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-secondary)" }}>
                Resume interrupted uploads whenever supported. Large files are split into parts
                and transferred reliably.
              </p>
            </div>

            {/* Benefit 3 */}
            <div className="vl-card p-8">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{ background: "var(--vl-warning-subtle)" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--vl-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--vl-text-primary)" }}>
                Secure Code Sharing
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-secondary)" }}>
                Access your transfer using a unique code. Share it through any channel — WhatsApp,
                email, or messaging apps.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className="py-20" style={{ background: "var(--vl-bg-primary)" }}>
        <div className="vl-container">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: "var(--vl-text-primary)" }}>
              How It Works
            </h2>
            <p className="text-base" style={{ color: "var(--vl-text-secondary)" }}>
              Three steps. No account required.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                step: "1",
                title: "Upload your video",
                desc: "Select any video file. We support MP4, MOV, MKV, WebM and more. Files up to 5 GB.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                ),
              },
              {
                step: "2",
                title: "Share your code",
                desc: "Get a unique transfer code like VL-7K9P-2M4X. Copy it or share directly via any messaging app.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                ),
              },
              {
                step: "3",
                title: "Download the original",
                desc: "The recipient enters the code and downloads the exact original file. No quality loss.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                  style={{
                    background: "var(--vl-accent-subtle)",
                    color: "var(--vl-accent)",
                  }}
                >
                  {item.icon}
                </div>
                <div
                  className="text-xs font-bold tracking-widest uppercase mb-2"
                  style={{ color: "var(--vl-accent-text)" }}
                >
                  Step {item.step}
                </div>
                <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--vl-text-primary)" }}>
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-secondary)" }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SECURITY ===== */}
      <section id="security" className="py-20" style={{ background: "var(--vl-bg-secondary)" }}>
        <div className="vl-container">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: "var(--vl-text-primary)" }}>
                Privacy &amp; Security
              </h2>
              <p className="text-base" style={{ color: "var(--vl-text-secondary)" }}>
                Your videos are treated as private by default.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[
                {
                  title: "Private Storage",
                  desc: "Videos are stored in private cloud storage. No public URLs are ever created.",
                },
                {
                  title: "Short-Lived Access",
                  desc: "Download links are authorized and expire within minutes.",
                },
                {
                  title: "Encrypted Transport",
                  desc: "All data is transmitted over HTTPS (TLS). Data at rest is encrypted by the storage provider.",
                },
                {
                  title: "Automatic Deletion",
                  desc: "Expired transfers are automatically cleaned up. You choose how long files are kept.",
                },
                {
                  title: "Optional Password",
                  desc: "Add a password for additional protection. Passwords are securely hashed.",
                },
                {
                  title: "Download Limits",
                  desc: "Set a maximum number of downloads to control access to your files.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="vl-card p-6 flex gap-4"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--vl-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1" style={{ color: "var(--vl-text-primary)" }}>
                      {item.title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-secondary)" }}>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mt-8 p-4 rounded-xl text-sm text-center"
              style={{
                background: "var(--vl-bg-card)",
                border: "1px solid var(--vl-border-default)",
                color: "var(--vl-text-tertiary)",
              }}
            >
              <strong>Note:</strong> VIDELINK uses HTTPS transport encryption and cloud storage encryption.
              This is not end-to-end encryption — the server processes upload and download authorization.
            </div>
          </div>
        </div>
      </section>

      {/* ===== STORAGE POLICY ===== */}
      <section className="py-20" style={{ background: "var(--vl-bg-primary)" }}>
        <div className="vl-container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: "var(--vl-text-primary)" }}>
              Storage &amp; Expiration
            </h2>
            <p className="text-base mb-8" style={{ color: "var(--vl-text-secondary)" }}>
              Transfers are temporary by design.
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { label: "1 Hour", desc: "Quick share" },
                { label: "24 Hours", desc: "Standard" },
                { label: "7 Days", desc: "Extended" },
              ].map((item) => (
                <div key={item.label} className="vl-card p-5 text-center">
                  <div className="font-bold text-xl mb-1" style={{ color: "var(--vl-accent)" }}>
                    {item.label}
                  </div>
                  <div className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "var(--vl-text-tertiary)" }}>
              When a transfer expires, all associated files are deleted from storage.
              Metadata may be retained briefly for cleanup verification.
              Maximum file size is 5 GB per transfer.
            </p>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="py-20" style={{ background: "var(--vl-bg-secondary)" }}>
        <div className="vl-container">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold mb-3" style={{ color: "var(--vl-text-primary)" }}>
                Frequently Asked Questions
              </h2>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: "Do I need an account to send or receive videos?",
                  a: "No. Guest transfers work without registration. An optional account lets you track transfer history.",
                },
                {
                  q: "What file formats are supported?",
                  a: "You can upload MP4, MOV, MKV, WebM, AVI, and other common video formats. The browser preview may not support every format, but you can always download the original.",
                },
                {
                  q: "Is my video modified during transfer?",
                  a: "Never. Your original file is stored as-is and downloaded exactly as uploaded. We verify file integrity using SHA-256 checksums.",
                },
                {
                  q: "What happens when my transfer expires?",
                  a: "The transfer becomes inaccessible and the file is scheduled for permanent deletion from storage.",
                },
                {
                  q: "How large can my video be?",
                  a: "The default maximum is 5 GB per file. Large files are uploaded in parts with automatic retry on failure.",
                },
                {
                  q: "Can I password-protect my transfer?",
                  a: "Yes. You can set an optional password that recipients must enter before accessing the video.",
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="vl-card group"
                >
                  <summary
                    className="p-5 cursor-pointer font-medium text-sm flex items-center justify-between list-none"
                    style={{ color: "var(--vl-text-primary)" }}
                  >
                    {item.q}
                    <svg
                      className="w-4 h-4 flex-shrink-0 transition-transform group-open:rotate-180"
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
                  </summary>
                  <div
                    className="px-5 pb-5 text-sm leading-relaxed"
                    style={{ color: "var(--vl-text-secondary)" }}
                  >
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== CTA SECTION ===== */}
      <section className="py-20" style={{ background: "var(--vl-bg-primary)" }}>
        <div className="vl-container text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ color: "var(--vl-text-primary)" }}>
            Ready to share a video?
          </h2>
          <p className="text-base mb-8" style={{ color: "var(--vl-text-secondary)" }}>
            No account required. Just upload and share your code.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/send" className="vl-btn-primary py-3 px-8">
              Send a Video
            </Link>
            <Link href="/receive" className="vl-btn-secondary py-3 px-8">
              Receive a Video
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
