import { execSync } from "node:child_process";
import fs from "node:fs";

export default function setup() {
  fs.mkdirSync("data", { recursive: true });
  fs.rmSync("data/test.db", { force: true });
  fs.rmSync("data/test-storage", { recursive: true, force: true });
  execSync("pnpm exec prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: "file:../data/test.db" },
    stdio: "pipe",
  });
}
