// Prisma Client with dynamic initialization and graceful fallback
let prismaClientInstance: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prismaPkg = require("@prisma/client");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");

  const databaseUrl = process.env.DATABASE_URL;

  if (prismaPkg && prismaPkg.PrismaClient && databaseUrl) {
    const globalForPrisma = globalThis as unknown as { prisma: any };
    if (globalForPrisma.prisma) {
      prismaClientInstance = globalForPrisma.prisma;
    } else {
      const adapter = new PrismaPg({ connectionString: databaseUrl });
      prismaClientInstance = new prismaPkg.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      });
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = prismaClientInstance;
      }
    }
  }
} catch (error) {
  console.warn("Failed to initialize Prisma with adapter-pg:", error);
  prismaClientInstance = null;
}

export const prisma = prismaClientInstance;
