import { defineConfig } from "prisma/config";

// Load .env.local if available in development
try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(".env.local");
  }
} catch {
  // Ignore if already loaded or not found
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
