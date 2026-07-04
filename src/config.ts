/** How the current binary/script was installed. */
export type InstallMethod = "npm" | "bun" | "binary" | "local-dev";

/**
 * A minimal `fetch`-compatible function. The global `fetch` satisfies this;
 * tests can supply a stub without implementing `fetch.preconnect`.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Platform descriptor passed to a custom {@link UpdaterConfig.assetName}. */
export interface AssetTarget {
  /** `process.platform` value, e.g. `"darwin"`, `"linux"`, `"win32"`. */
  platform: string;
  /** `process.arch` value, e.g. `"arm64"`, `"x64"`. */
  arch: string;
}

/** Data passed to a custom {@link UpdaterConfig.formatNotice} renderer. */
export interface NoticeContext {
  /** The currently-running version. */
  currentVersion: string;
  /** The newer version available. */
  latestVersion: string;
  /** Release changelog, when one was fetched. */
  changelog?: string;
  /** Display name for the CLI (see {@link UpdaterConfig.cliName}). */
  cliName: string;
}

/**
 * Configuration for {@link createUpdater}. Every value that would otherwise be
 * hardcoded to a specific project (repo, package name, cache location, …) is a
 * parameter here so the same logic works for any Bun CLI.
 */
export interface UpdaterConfig {
  /** The currently-running version, e.g. your `package.json` version. */
  currentVersion: string;
  /** npm package name — used for the registry lookup and `install -g <pkg>@<v>`. */
  packageName: string;
  /** GitHub repository as `"owner/name"` — used for release binaries + changelog. */
  repo: string;
  /**
   * Prefix for GitHub release binary assets. The default asset name is
   * `<binaryName>-<os>-<arch>[.exe]` (os ∈ darwin|linux|windows).
   */
  binaryName: string;
  /** Directory that holds the `update.json` check cache (e.g. `~/.myapp`). */
  cacheDir: string;

  /** Display name used in notices and the "Run `<cliName> upgrade`" hint. Defaults to {@link packageName}. */
  cliName?: string;
  /** Env var name that, when set to `"1"`, disables the background check. Omit to never opt out. */
  noUpdateCheckEnv?: string;
  /** Substring of the entry script that marks a local source checkout. Defaults to `"src/cli.ts"`. */
  localDevEntry?: string;
  /** How long a cached check stays fresh, in ms. Defaults to 24h. */
  checkIntervalMs?: number;
  /** Timeout for the background network check, in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Commands for which the background notice is suppressed. Defaults to `["check-update", "upgrade"]`. */
  backgroundSkipCommands?: string[];
  /**
   * Render the whole background notice string. Receives the update details and
   * returns the text shown to the user. Defaults to the built-in {@link formatNotice},
   * which you can import and compose with (e.g. prefix or suffix its output).
   */
  formatNotice?: (ctx: NoticeContext) => string;
  /** Override the full release asset name for a platform. */
  assetName?: (target: AssetTarget) => string;
  /** Injectable `fetch` (for testing). Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Called with human-readable progress messages (e.g. sudo prompts). Defaults to a no-op. */
  onProgress?: (message: string) => void;
}

/** {@link UpdaterConfig} with defaults applied. */
export interface ResolvedConfig {
  currentVersion: string;
  packageName: string;
  repo: string;
  binaryName: string;
  cacheDir: string;
  cliName: string;
  noUpdateCheckEnv: string | undefined;
  localDevEntry: string;
  checkIntervalMs: number;
  timeoutMs: number;
  backgroundSkipCommands: string[];
  formatNotice: ((ctx: NoticeContext) => string) | undefined;
  assetName: ((target: AssetTarget) => string) | undefined;
  fetchImpl: FetchLike;
  onProgress: (message: string) => void;
}

export const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_LOCAL_DEV_ENTRY = "src/cli.ts";
export const DEFAULT_BACKGROUND_SKIP_COMMANDS = ["check-update", "upgrade"];

/** Apply defaults to a user-supplied {@link UpdaterConfig}. */
export function resolveConfig(config: UpdaterConfig): ResolvedConfig {
  return {
    currentVersion: config.currentVersion,
    packageName: config.packageName,
    repo: config.repo,
    binaryName: config.binaryName,
    cacheDir: config.cacheDir,
    cliName: config.cliName ?? config.packageName,
    noUpdateCheckEnv: config.noUpdateCheckEnv,
    localDevEntry: config.localDevEntry ?? DEFAULT_LOCAL_DEV_ENTRY,
    checkIntervalMs: config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    backgroundSkipCommands:
      config.backgroundSkipCommands ?? DEFAULT_BACKGROUND_SKIP_COMMANDS,
    formatNotice: config.formatNotice,
    assetName: config.assetName,
    fetchImpl: config.fetchImpl ?? fetch,
    onProgress: config.onProgress ?? (() => {}),
  };
}
