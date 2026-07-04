import { describe, expect, test } from "bun:test";
import {
  checkForUpdate,
  detectInstallMethod,
  fetchChangelog,
  fetchLatestVersion,
  isNewerVersion,
  needsCheck,
  type UpdateCache,
} from "../src/checker.ts";
import type { FetchLike } from "../src/config.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("isNewerVersion", () => {
  test("true when latest is newer", () => {
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
  });
  test("false when equal or older", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
  });
});

describe("needsCheck", () => {
  test("true when cache missing or without timestamp", () => {
    expect(needsCheck(undefined, DAY)).toBe(true);
    expect(
      needsCheck(
        { latestVersion: "1.0.0", hasUpdate: false } as UpdateCache,
        DAY,
      ),
    ).toBe(true);
  });
  test("true when older than the interval, false when fresh", () => {
    const old = new Date(Date.now() - 25 * HOUR).toISOString();
    const recent = new Date(Date.now() - 1 * HOUR).toISOString();
    expect(
      needsCheck(
        { lastCheckAt: old, latestVersion: "1.0.0", hasUpdate: false },
        DAY,
      ),
    ).toBe(true);
    expect(
      needsCheck(
        { lastCheckAt: recent, latestVersion: "1.0.0", hasUpdate: false },
        DAY,
      ),
    ).toBe(false);
  });
});

describe("detectInstallMethod", () => {
  test("local-dev when running the source entry outside node_modules", () => {
    expect(
      detectInstallMethod({
        argv: ["bun", "/home/me/proj/src/cli.ts"],
        execPath: "/usr/bin/bun",
      }),
    ).toBe("local-dev");
  });
  test("binary when execPath is not bun/node", () => {
    expect(
      detectInstallMethod({
        argv: ["/usr/local/bin/myapp"],
        execPath: "/usr/local/bin/myapp",
      }),
    ).toBe("binary");
  });
  test("bun for a .bun global install", () => {
    expect(
      detectInstallMethod({
        argv: ["bun", "/home/me/.bun/bin/myapp"],
        execPath: "/home/me/.bun/bin/bun",
      }),
    ).toBe("bun");
  });
  test("npm as the node_modules fallback", () => {
    expect(
      detectInstallMethod({
        argv: ["node", "/usr/lib/node_modules/myapp/dist/cli.js"],
        execPath: "/usr/bin/node",
      }),
    ).toBe("npm");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchLatestVersion", () => {
  test("returns the registry version", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ version: "2.5.0" })) satisfies FetchLike;
    const v = await fetchLatestVersion({
      packageName: "x",
      currentVersion: "1.0.0",
      fetchImpl,
    });
    expect(v).toBe("2.5.0");
  });
  test("falls back to currentVersion on non-2xx", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 500 })) satisfies FetchLike;
    const v = await fetchLatestVersion({
      packageName: "x",
      currentVersion: "1.0.0",
      fetchImpl,
    });
    expect(v).toBe("1.0.0");
  });
  test("falls back to currentVersion when fetch throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) satisfies FetchLike;
    const v = await fetchLatestVersion({
      packageName: "x",
      currentVersion: "1.2.3",
      fetchImpl,
    });
    expect(v).toBe("1.2.3");
  });
});

describe("fetchChangelog", () => {
  test("returns markdown for releases strictly between from and to", async () => {
    const fetchImpl = (async () =>
      jsonResponse([
        { tag_name: "v1.3.0", body: "future" },
        { tag_name: "v1.2.0", body: "middle" },
        { tag_name: "v1.1.0", body: "included" },
        { tag_name: "v1.0.0", body: "current" },
      ])) satisfies FetchLike;
    const md = await fetchChangelog({
      repo: "o/r",
      fromVersion: "1.0.0",
      toVersion: "1.2.0",
      fetchImpl,
    });
    expect(md).toContain("## v1.2.0");
    expect(md).toContain("## v1.1.0");
    expect(md).not.toContain("## v1.3.0"); // above `to`
    expect(md).not.toContain("## v1.0.0"); // equal to `from`
  });
  test("undefined on error", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 404 })) satisfies FetchLike;
    expect(
      await fetchChangelog({
        repo: "o/r",
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        fetchImpl,
      }),
    ).toBeUndefined();
  });
});

describe("checkForUpdate", () => {
  test("reports an update and fetches the changelog", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("registry.npmjs.org"))
        return jsonResponse({ version: "2.0.0" });
      return jsonResponse([{ tag_name: "v2.0.0", body: "notes" }]);
    }) satisfies FetchLike;

    const info = await checkForUpdate({
      packageName: "x",
      repo: "o/r",
      currentVersion: "1.0.0",
      fetchImpl,
    });
    expect(info.hasUpdate).toBe(true);
    expect(info.aheadOfLatest).toBe(false);
    expect(info.latestVersion).toBe("2.0.0");
    expect(info.changelog).toContain("## v2.0.0");
  });

  test("no update (and skips changelog) when current is latest", async () => {
    let changelogFetched = false;
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("registry.npmjs.org"))
        return jsonResponse({ version: "1.0.0" });
      changelogFetched = true;
      return jsonResponse([]);
    }) satisfies FetchLike;

    const info = await checkForUpdate({
      packageName: "x",
      repo: "o/r",
      currentVersion: "1.0.0",
      fetchImpl,
    });
    expect(info.hasUpdate).toBe(false);
    expect(changelogFetched).toBe(false);
  });
});
