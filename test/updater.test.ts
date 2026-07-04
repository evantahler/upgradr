import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCache, saveCache } from "../src/cache.ts";
import {
  createUpdater,
  type FetchLike,
  type UpdaterConfig,
} from "../src/index.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "upgradr-updater-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function baseConfig(over: Partial<UpdaterConfig> = {}): UpdaterConfig {
  return {
    currentVersion: "1.0.0",
    packageName: "myapp",
    repo: "o/r",
    binaryName: "myapp",
    cacheDir: tmp(),
    ...over,
  };
}

describe("createUpdater.upgrade", () => {
  test("always performs a fresh check — ignores a stale cache claiming an update", async () => {
    const cacheDir = tmp();
    // A fresh-but-wrong cache saying an update is available.
    await saveCache(cacheDir, {
      lastCheckAt: new Date().toISOString(),
      latestVersion: "9.9.9",
      hasUpdate: true,
    });

    // The live registry says we're already current — no install must happen.
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("registry.npmjs.org")) {
        return jsonResponse({ version: "1.0.0" });
      }
      return jsonResponse([]);
    }) satisfies FetchLike;

    const updater = createUpdater(baseConfig({ cacheDir, fetchImpl }));
    const result = await updater.upgrade();

    expect(result.hasUpdate).toBe(false);
    expect(result.performed).toBe(false);
    expect(result.success).toBe(true);
    expect(result.to).toBe("1.0.0");

    // The stale cache was corrected by the fresh check.
    const cache = await loadCache(cacheDir);
    expect(cache?.hasUpdate).toBe(false);
    expect(cache?.latestVersion).toBe("1.0.0");
  });
});

describe("createUpdater.maybeBackgroundNotice", () => {
  const noNet = (async () => {
    throw new Error("no network in this test");
  }) satisfies FetchLike;

  test("null when opted out via env", async () => {
    const updater = createUpdater(
      baseConfig({
        noUpdateCheckEnv: "MYAPP_NO_UPDATE_CHECK",
        fetchImpl: noNet,
      }),
    );
    const notice = await updater.maybeBackgroundNotice({
      env: { MYAPP_NO_UPDATE_CHECK: "1" },
      argv: ["node", "myapp", "chat"],
      isTTY: true,
    });
    expect(notice).toBeNull();
  });

  test("null for update-related commands", async () => {
    const updater = createUpdater(baseConfig({ fetchImpl: noNet }));
    expect(
      await updater.maybeBackgroundNotice({
        env: {},
        argv: ["node", "myapp", "upgrade"],
        isTTY: true,
      }),
    ).toBeNull();
  });

  test("null when not a TTY", async () => {
    const updater = createUpdater(baseConfig({ fetchImpl: noNet }));
    expect(
      await updater.maybeBackgroundNotice({
        env: {},
        argv: ["node", "myapp", "chat"],
        isTTY: false,
      }),
    ).toBeNull();
  });

  test("formats a notice from a fresh cache that has an update", async () => {
    const cacheDir = tmp();
    await saveCache(cacheDir, {
      lastCheckAt: new Date().toISOString(),
      latestVersion: "3.0.0",
      hasUpdate: true,
      changelog: "## v3.0.0\nbig",
    });
    const updater = createUpdater(
      baseConfig({ cacheDir, cliName: "myapp", fetchImpl: noNet }),
    );
    const notice = await updater.maybeBackgroundNotice({
      env: {},
      argv: ["node", "myapp", "chat"],
      isTTY: true,
    });
    expect(notice).toContain("Update available: 1.0.0 → 3.0.0");
    expect(notice).toContain("myapp upgrade");
  });

  test("uses a custom formatNotice renderer when provided", async () => {
    const cacheDir = tmp();
    await saveCache(cacheDir, {
      lastCheckAt: new Date().toISOString(),
      latestVersion: "3.0.0",
      hasUpdate: true,
      changelog: "## v3.0.0\nbig",
    });
    const updater = createUpdater(
      baseConfig({
        cacheDir,
        cliName: "myapp",
        fetchImpl: noNet,
        formatNotice: (ctx) =>
          `custom ${ctx.cliName} ${ctx.currentVersion}->${ctx.latestVersion}`,
      }),
    );
    const notice = await updater.maybeBackgroundNotice({
      env: {},
      argv: ["node", "myapp", "chat"],
      isTTY: true,
    });
    expect(notice).toBe("custom myapp 1.0.0->3.0.0");
    expect(notice).not.toContain("Update available:");
  });
});
