// Prisma Client with dynamic initialization and graceful fallback
let prismaClientInstance: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const prismaPkg = require("@prisma/client");
  if (prismaPkg && prismaPkg.PrismaClient) {
    const globalForPrisma = globalThis as unknown as { prisma: any };
    prismaClientInstance =
      globalForPrisma.prisma ??
      new prismaPkg.PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
      });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = prismaClientInstance;
    }
  }
} catch {
  prismaClientInstance = null;
}

export const prisma = prismaClientInstance;
