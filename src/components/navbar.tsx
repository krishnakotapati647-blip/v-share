"use client";

import Link from "next/link";
import { useTheme } from "./theme-provider";
import { useState } from "react";

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{
        background: "var(--vl-bg-card)",
        borderColor: "var(--vl-border-subtle)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor:
          theme === "dark"
            ? "rgba(26, 27, 32, 0.85)"
            : "rgba(255, 255, 255, 0.85)",
      }}
    >
      <div className="vl-container flex items-center justify-between h-16">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-bold text-xl tracking-tight"
          style={{ color: "var(--vl-text-primary)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, var(--vl-accent), #a78bfa)",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          VIDELINK
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          <a
            href="#how-it-works"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--vl-text-secondary)" }}
          >
            How It Works
          </a>
          <a
            href="#security"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--vl-text-secondary)" }}
          >
            Security
          </a>
          <a
            href="#faq"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--vl-text-secondary)" }}
          >
            Help
          </a>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors"
            style={{
              background: "var(--vl-bg-secondary)",
              color: "var(--vl-text-secondary)",
            }}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          <Link
            href="/receive"
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--vl-text-secondary)" }}
          >
            Receive Video
          </Link>
          <Link href="/send" className="vl-btn-primary text-sm py-2 px-4">
            Send Video
          </Link>
        </div>

        {/* Mobile Hamburger */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          style={{ color: "var(--vl-text-primary)" }}
        >
          {mobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div
          className="md:hidden border-t py-4 px-6 flex flex-col gap-4"
          style={{
            background: "var(--vl-bg-card)",
            borderColor: "var(--vl-border-subtle)",
          }}
        >
          <Link
            href="/receive"
            className="text-sm font-medium"
            style={{ color: "var(--vl-text-secondary)" }}
            onClick={() => setMobileOpen(false)}
          >
            Receive Video
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium"
            style={{ color: "var(--vl-text-secondary)" }}
            onClick={() => setMobileOpen(false)}
          >
            How It Works
          </a>
          <a
            href="#security"
            className="text-sm font-medium"
            style={{ color: "var(--vl-text-secondary)" }}
            onClick={() => setMobileOpen(false)}
          >
            Security
          </a>
          <a
            href="#faq"
            className="text-sm font-medium"
            style={{ color: "var(--vl-text-secondary)" }}
            onClick={() => setMobileOpen(false)}
          >
            Help
          </a>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg"
              style={{
                background: "var(--vl-bg-secondary)",
                color: "var(--vl-text-secondary)",
              }}
              aria-label="Toggle theme"
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
            <Link
              href="/send"
              className="vl-btn-primary text-sm py-2 px-4 flex-1 text-center"
              onClick={() => setMobileOpen(false)}
            >
              Send Video
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
