import { cyan, dim, yellow } from "ansis";
import { loadCache, saveCache } from "./cache.ts";
import { checkForUpdate, needsCheck, type UpdateCache } from "./checker.ts";
import type { NoticeContext, ResolvedConfig } from "./config.ts";

/** Format the "update available" notice shown on startup. */
export function formatNotice(ctx: NoticeContext): string {
  const lines: string[] = [
    "",
    yellow(`Update available: ${ctx.currentVersion} → ${ctx.latestVersion}`),
  ];

  if (ctx.changelog) {
    lines.push("");
    lines.push(dim(ctx.changelog));
  }

  lines.push("");
  lines.push(cyan(`Run \`${ctx.cliName} upgrade\` to update`));
  lines.push("");

  return lines.join("\n");
}

/**
 * Non-blocking background update check. Returns a formatted notice string if an
 * update is available, or `null` otherwise. Never throws. Uses a fresh (<24h)
 * cache when present; otherwise performs a network check bounded by `timeoutMs`
 * and refreshes the cache.
 *
 * `env`, `argv`, and `isTTY` are injectable for testing.
 */
export async function maybeBackgroundNotice(
  cfg: ResolvedConfig,
  overrides?: {
    env?: NodeJS.ProcessEnv;
    argv?: string[];
    isTTY?: boolean;
  },
): Promise<string | null> {
  try {
    const env = overrides?.env ?? process.env;
    const argv = overrides?.argv ?? process.argv;
    const isTTY = overrides?.isTTY ?? process.stderr.isTTY ?? false;

    // Opt-out via env var.
    if (cfg.noUpdateCheckEnv && env[cfg.noUpdateCheckEnv] === "1") return null;

    // Skip when running an update-related command.
    const args = argv.slice(2);
    const command = args.find((a) => !a.startsWith("-"));
    if (command && cfg.backgroundSkipCommands.includes(command)) return null;

    // Only show in an interactive terminal.
    if (!isTTY) return null;

    const render = cfg.formatNotice ?? formatNotice;
    const cache = await loadCache(cfg.cacheDir);

    if (!needsCheck(cache, cfg.checkIntervalMs)) {
      // Cache is fresh — use the cached result.
      if (cache?.hasUpdate) {
        return render({
          currentVersion: cfg.currentVersion,
          latestVersion: cache.latestVersion,
          changelog: cache.changelog,
          cliName: cfg.cliName,
        });
      }
      return null;
    }

    // Cache is stale or missing — check with a timeout.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const info = await checkForUpdate({
        packageName: cfg.packageName,
        repo: cfg.repo,
        currentVersion: cfg.currentVersion,
        fetchImpl: cfg.fetchImpl,
        signal: controller.signal,
      });

      const newCache: UpdateCache = {
        lastCheckAt: new Date().toISOString(),
        latestVersion: info.latestVersion,
        hasUpdate: info.hasUpdate,
        changelog: info.changelog,
      };
      await saveCache(cfg.cacheDir, newCache);

      if (info.hasUpdate) {
        return render({
          currentVersion: cfg.currentVersion,
          latestVersion: info.latestVersion,
          changelog: info.changelog,
          cliName: cfg.cliName,
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    return null;
  } catch {
    return null;
  }
}
