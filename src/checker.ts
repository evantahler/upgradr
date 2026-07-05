import lt from "semver/functions/lt.js";
import type { FetchLike, InstallMethod } from "./config.ts";

/** The result of checking for an update. */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  /** `latest > current`. */
  hasUpdate: boolean;
  /** `current > latest` — running ahead of the published release (dev build). */
  aheadOfLatest: boolean;
  changelog?: string;
  /**
   * Set when the latest version could not be determined (registry non-OK,
   * network failure, timeout, or offline). When present, `hasUpdate` is `false`
   * because the check did not complete — not because the CLI is current.
   */
  error?: string;
}

/** The persisted result of a previous check (see `cache.ts`). */
export interface UpdateCache {
  lastCheckAt: string;
  latestVersion: string;
  hasUpdate: boolean;
  changelog?: string;
}

/** Compare two semver strings. Returns true if `latest > current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  try {
    return lt(current, latest, { loose: true });
  } catch {
    // Unparseable version (e.g. a non-semver git tag) is never "newer".
    return false;
  }
}

/**
 * Fetch the latest published version from the npm registry. Returns `null` when
 * the version could not be determined (registry non-OK, network failure,
 * timeout, or offline) so callers can distinguish "confirmed current" from
 * "couldn't check".
 */
export async function fetchLatestVersion(opts: {
  packageName: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<string | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `https://registry.npmjs.org/${opts.packageName}/latest`,
      { signal: opts.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

/** Fetch a markdown changelog from GitHub releases between two versions. */
export async function fetchChangelog(opts: {
  repo: string;
  fromVersion: string;
  toVersion: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `https://api.github.com/repos/${opts.repo}/releases?per_page=20`,
      {
        signal: opts.signal,
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    );
    if (!res.ok) return undefined;

    const releases = (await res.json()) as Array<{
      tag_name: string;
      body: string | null;
    }>;

    const relevant = releases.filter((r) => {
      const v = r.tag_name.replace(/^v/, "");
      return (
        isNewerVersion(opts.fromVersion, v) &&
        !isNewerVersion(opts.toVersion, v)
      );
    });

    if (relevant.length === 0) return undefined;

    return relevant
      .map((r) => `## ${r.tag_name}\n${r.body ?? ""}`)
      .join("\n\n")
      .trim();
  } catch {
    return undefined;
  }
}

/** Check npm for a newer version and fetch the changelog if one is available. */
export async function checkForUpdate(opts: {
  packageName: string;
  repo: string;
  currentVersion: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<UpdateInfo> {
  const latestVersion = await fetchLatestVersion({
    packageName: opts.packageName,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
  });

  if (latestVersion === null) {
    // The check did not complete — surface it rather than reporting "current".
    return {
      currentVersion: opts.currentVersion,
      latestVersion: opts.currentVersion,
      hasUpdate: false,
      aheadOfLatest: false,
      error: `Could not determine the latest version of "${opts.packageName}" from the npm registry.`,
    };
  }

  const hasUpdate = isNewerVersion(opts.currentVersion, latestVersion);
  const aheadOfLatest = isNewerVersion(latestVersion, opts.currentVersion);

  let changelog: string | undefined;
  if (hasUpdate) {
    changelog = await fetchChangelog({
      repo: opts.repo,
      fromVersion: opts.currentVersion,
      toVersion: latestVersion,
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
    });
  }

  return {
    currentVersion: opts.currentVersion,
    latestVersion,
    hasUpdate,
    aheadOfLatest,
    changelog,
  };
}

/** Returns true if the cache is missing or older than `intervalMs`. */
export function needsCheck(
  cache: UpdateCache | undefined,
  intervalMs: number,
): boolean {
  if (!cache?.lastCheckAt) return true;
  return Date.now() - new Date(cache.lastCheckAt).getTime() > intervalMs;
}

/** Detect how the CLI was installed, from the entry script and exec path. */
export function detectInstallMethod(opts?: {
  localDevEntry?: string;
  argv?: string[];
  execPath?: string;
}): InstallMethod {
  const localDevEntry = opts?.localDevEntry ?? "src/cli.ts";
  const script = opts?.argv?.[1] ?? process.argv[1] ?? "";
  const execPath = opts?.execPath ?? process.execPath;

  // Local dev: running the source entry directly, outside node_modules.
  if (script.includes(localDevEntry) && !script.includes("node_modules")) {
    return "local-dev";
  }

  // Compiled binary: execPath is the binary itself (not bun/node).
  if (!execPath.includes("bun") && !execPath.includes("node")) {
    return "binary";
  }

  // Bun global install: path lives under .bun/install or .bun/bin.
  if (script.includes(".bun/install") || script.includes(".bun/bin")) {
    return "bun";
  }

  // npm global install: fallback for node_modules paths.
  return "npm";
}
