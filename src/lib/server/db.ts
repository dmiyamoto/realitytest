import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  const dir = path.resolve("data");
  fs.mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${path.join(dir, "realitytest.db")}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
