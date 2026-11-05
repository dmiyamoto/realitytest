import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default function globalSetup() {
  fs.mkdirSync("data", { recursive: true });
  for (const f of ["data/e2e.db", "data/e2e.db-journal"]) fs.rmSync(f, { force: true });
  fs.rmSync("data/e2e-storage", { recursive: true, force: true });
  execSync("pnpm exec prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: `file:${path.resolve("data/e2e.db")}` },
    stdio: "pipe",
  });
}
