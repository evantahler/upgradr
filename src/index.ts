import { clearCache, loadCache, saveCache } from "./cache.ts";
import {
  checkForUpdate as checkForUpdateImpl,
  detectInstallMethod as detectInstallMethodImpl,
  needsCheck as needsCheckImpl,
  type UpdateCache,
  type UpdateInfo,
} from "./checker.ts";
import {
  type InstallMethod,
  type ResolvedConfig,
  resolveConfig,
  type UpdaterConfig,
} from "./config.ts";
import { maybeBackgroundNotice } from "./notice.ts";
import {
  type InstallOutcome,
  upgradeFromBinary,
  upgradeWithPackageManager,
} from "./upgrade.ts";

export {
  fetchChangelog,
  fetchLatestVersion,
  isNewerVersion,
  type UpdateCache,
  type UpdateInfo,
} from "./checker.ts";
export type {
  AssetTarget,
  FetchLike,
  InstallMethod,
  NoticeContext,
  ResolvedConfig,
  UpdaterConfig,
} from "./config.ts";
export { formatNotice } from "./notice.ts";
export {
  type InstallOutcome,
  platformArtifactName,
} from "./upgrade.ts";

/** The outcome of {@link Updater.upgrade}. */
export interface UpgradeResult {
  /** How the running CLI was installed. */
  method: InstallMethod;
  /** The version that was running. */
  from: string;
  /** The latest published version. */
  to: string;
  /** Whether a newer version is available. */
  hasUpdate: boolean;
  /** Whether an install was attempted (false when already current or local-dev). */
  performed: boolean;
  /** Whether the upgrade succeeded (true and un-performed means already current). */
  success: boolean;
  /** Error detail when `success` is false. */
  error?: string;
}

/** A configured self-updater. Returned by {@link createUpdater}. */
export interface Updater {
  /** The resolved configuration (with defaults applied). */
  readonly config: ResolvedConfig;
  /** Perform a fresh update check against npm (and GitHub for the changelog). */
  checkForUpdate(signal?: AbortSignal): Promise<UpdateInfo>;
  /** Whether a cached result is missing or stale. */
  needsCheck(cache?: UpdateCache): boolean;
  /** Detect how the CLI was installed. */
  detectInstallMethod(): InstallMethod;
  /** Load the persisted check cache. */
  loadCache(): Promise<UpdateCache | undefined>;
  /** Persist a check result. */
  saveCache(cache: UpdateCache): Promise<void>;
  /** Remove the persisted check cache. */
  clearCache(): Promise<void>;
  /** Non-blocking startup notice (cache-first). Returns a string or `null`. */
  maybeBackgroundNotice(overrides?: {
    env?: NodeJS.ProcessEnv;
    argv?: string[];
    isTTY?: boolean;
  }): Promise<string | null>;
  /**
   * Upgrade in place. Always performs a fresh check first (never trusting a
   * possibly-stale cache), then installs via the detected method. The caller
   * owns all presentation — this returns a result and never writes to the
   * console or exits the process.
   */
  upgrade(): Promise<UpgradeResult>;
}

/** Create a self-updater bound to your project's {@link UpdaterConfig}. */
export function createUpdater(config: UpdaterConfig): Updater {
  const cfg = resolveConfig(config);

  const checkFresh = (signal?: AbortSignal): Promise<UpdateInfo> =>
    checkForUpdateImpl({
      packageName: cfg.packageName,
      repo: cfg.repo,
      currentVersion: cfg.currentVersion,
      fetchImpl: cfg.fetchImpl,
      signal,
    });

  return {
    config: cfg,

    checkForUpdate: checkFresh,

    needsCheck: (cache) => needsCheckImpl(cache, cfg.checkIntervalMs),

    detectInstallMethod: () =>
      detectInstallMethodImpl({ localDevEntry: cfg.localDevEntry }),

    loadCache: () => loadCache(cfg.cacheDir),
    saveCache: (cache) => saveCache(cfg.cacheDir, cache),
    clearCache: () => clearCache(cfg.cacheDir),

    maybeBackgroundNotice: (overrides) => maybeBackgroundNotice(cfg, overrides),

    async upgrade(): Promise<UpgradeResult> {
      // Always re-check: the background cache may be fresh but stale relative
      // to a release that shipped since the last check.
      const info = await checkFresh();
      await saveCache(cfg.cacheDir, {
        lastCheckAt: new Date().toISOString(),
        latestVersion: info.latestVersion,
        hasUpdate: info.hasUpdate,
        changelog: info.changelog,
      });

      const method = detectInstallMethodImpl({
        localDevEntry: cfg.localDevEntry,
      });
      const base = {
        method,
        from: cfg.currentVersion,
        to: info.latestVersion,
        hasUpdate: info.hasUpdate,
      };

      if (!info.hasUpdate) {
        return { ...base, performed: false, success: true };
      }

      if (method === "local-dev") {
        return { ...base, performed: false, success: false };
      }

      let outcome: InstallOutcome;
      switch (method) {
        case "bun":
          outcome = await upgradeWithPackageManager("bun", [
            "install",
            "-g",
            `${cfg.packageName}@${info.latestVersion}`,
          ]);
          break;
        case "npm":
          outcome = await upgradeWithPackageManager("npm", [
            "install",
            "-g",
            `${cfg.packageName}@${info.latestVersion}`,
          ]);
          break;
        case "binary":
          outcome = await upgradeFromBinary({
            repo: cfg.repo,
            latestVersion: info.latestVersion,
            binaryName: cfg.binaryName,
            assetName: cfg.assetName,
            fetchImpl: cfg.fetchImpl,
            onProgress: cfg.onProgress,
          });
          break;
      }

      if (outcome.success) await clearCache(cfg.cacheDir);
      return {
        ...base,
        performed: true,
        success: outcome.success,
        error: outcome.error,
      };
    },
  };
}
