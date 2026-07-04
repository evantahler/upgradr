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
    const file = Bun.file(cachePath(cacheDir));
    if (!(await file.exists())) return undefined;
    return JSON.parse(await file.text()) as UpdateCache;
  } catch {
    return undefined;
  }
}

/** Save an update-check result to the cache file. Silently ignores write errors. */
export async function saveCache(
  cacheDir: string,
  cache: UpdateCache,
): Promise<void> {
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(cacheDir, { recursive: true });
    await Bun.write(cachePath(cacheDir), `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Ignore write failures (e.g. permissions).
  }
}

/** Remove the cached update-check result. Never throws. */
export async function clearCache(cacheDir: string): Promise<void> {
  try {
    const file = Bun.file(cachePath(cacheDir));
    if (await file.exists()) {
      const { unlink } = await import("node:fs/promises");
      await unlink(cachePath(cacheDir));
    }
  } catch {
    // Ignore.
  }
}
