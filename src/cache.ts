import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateCache } from "./checker.ts";

function cachePath(cacheDir: string): string {
  return join(cacheDir, "update.json");
}

/** Load the cached update-check result, if it exists. Never throws. */
export async function loadCache(
  cacheDir: string,
): Promise<UpdateCache | undefined> {
  try {
    const text = await readFile(cachePath(cacheDir), "utf8");
    return JSON.parse(text) as UpdateCache;
  } catch {
    // Missing file, unreadable, or invalid JSON — treat as no cache.
    return undefined;
  }
}

/** Save an update-check result to the cache file. Silently ignores write errors. */
export async function saveCache(
  cacheDir: string,
  cache: UpdateCache,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(cacheDir), `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Ignore write failures (e.g. permissions).
  }
}

/** Remove the cached update-check result. Never throws. */
export async function clearCache(cacheDir: string): Promise<void> {
  try {
    await unlink(cachePath(cacheDir));
  } catch {
    // Ignore (e.g. file already absent).
  }
}
