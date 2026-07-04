import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, loadCache, saveCache } from "../src/cache.ts";
import type { UpdateCache } from "../src/checker.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "upgradr-cache-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("cache", () => {
  const sample: UpdateCache = {
    lastCheckAt: "2026-01-01T00:00:00.000Z",
    latestVersion: "1.2.3",
    hasUpdate: true,
    changelog: "## v1.2.3\nhi",
  };

  test("undefined before anything is written", async () => {
    expect(await loadCache(tmp())).toBeUndefined();
  });

  test("save then load round-trips (creating the dir)", async () => {
    const dir = join(tmp(), "nested", "cachedir");
    await saveCache(dir, sample);
    expect(await loadCache(dir)).toEqual(sample);
  });

  test("clear removes the cache", async () => {
    const dir = tmp();
    await saveCache(dir, sample);
    await clearCache(dir);
    expect(await loadCache(dir)).toBeUndefined();
  });

  test("load returns undefined on corrupt JSON", async () => {
    const dir = tmp();
    await Bun.write(join(dir, "update.json"), "{ not json");
    expect(await loadCache(dir)).toBeUndefined();
  });
});
