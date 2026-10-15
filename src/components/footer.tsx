"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer
      className="border-t mt-auto"
      style={{
        background: "var(--vl-bg-card)",
        borderColor: "var(--vl-border-subtle)",
      }}
    >
      <div className="vl-container py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 font-bold text-lg mb-3" style={{ color: "var(--vl-text-primary)" }}>
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, var(--vl-accent), #a78bfa)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
              VIDELINK
            </div>
            <p className="text-sm leading-relaxed max-w-sm" style={{ color: "var(--vl-text-tertiary)" }}>
              Send large videos using secure transfer codes. Your original files stay unchanged.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-sm mb-3" style={{ color: "var(--vl-text-primary)" }}>
              Product
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href="/send" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  Send Video
                </Link>
              </li>
              <li>
                <Link href="/receive" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  Receive Video
                </Link>
              </li>
              <li>
                <a href="#how-it-works" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  How It Works
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-sm mb-3" style={{ color: "var(--vl-text-primary)" }}>
              Legal
            </h4>
            <ul className="space-y-2">
              <li>
                <Link href="/privacy" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  Terms of Service
                </Link>
              </li>
              <li>
                <a href="mailto:support@videlink.app" className="text-sm hover:underline" style={{ color: "var(--vl-text-secondary)" }}>
                  Support
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-2"
          style={{ borderColor: "var(--vl-border-subtle)" }}
        >
          <p className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
            © 2026 VIDELINK. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: "var(--vl-text-tertiary)" }}>
            Files are stored securely and deleted after expiration.
          </p>
        </div>
      </div>
    </footer>
  );
}
