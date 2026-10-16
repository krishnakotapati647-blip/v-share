import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString =
  "postgresql://postgres.njiclsrmarfdzdryzvvs:ZgDB9noAel0I7IN0@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true";

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Connecting to Supabase PostgreSQL via PrismaPg adapter...");
  const result = await prisma.$queryRaw`SELECT 1 as connected, NOW() as server_time`;
  console.log("SUCCESS! Connected to Supabase:", result);

  // Check transfers count
  const count = await prisma.transfer.count();
  console.log("Transfer table row count:", count);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Connection failed:", err);
  process.exit(1);
});
