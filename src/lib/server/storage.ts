import fs from "node:fs";
import path from "node:path";

export function storageDir(): string {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || "./storage");
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  return dir;
}

export function uploadPath(jobId: string, ext: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error("invalid job id");
  return path.join(storageDir(), "uploads", `${jobId}.${ext}`);
}
