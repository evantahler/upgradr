import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { AssetTarget, FetchLike } from "./config.ts";

/** Outcome of a binary or package-manager install attempt. */
export interface InstallOutcome {
  success: boolean;
  error?: string;
}

/**
 * Build the GitHub release asset name for the current platform.
 * Defaults to `<binaryName>-<os>-<arch>[.exe]`, or delegates to `assetName`.
 */
export function platformArtifactName(opts: {
  binaryName: string;
  platform?: string;
  arch?: string;
  assetName?: (target: AssetTarget) => string;
}): string {
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;

  if (opts.assetName) return opts.assetName({ platform, arch });

  let os: string;
  let ext = "";
  switch (platform) {
    case "darwin":
      os = "darwin";
      break;
    case "win32":
      os = "windows";
      ext = ".exe";
      break;
    default:
      os = "linux";
      break;
  }
  const normalizedArch = arch === "arm64" ? "arm64" : "x64";
  return `${opts.binaryName}-${os}-${normalizedArch}${ext}`;
}

/** Run a global install via a package manager, e.g. `npm install -g pkg@1.2.3`. */
export async function upgradeWithPackageManager(
  command: string,
  args: string[],
): Promise<InstallOutcome> {
  const result = await $`${command} ${args}`.nothrow();
  return result.exitCode === 0
    ? { success: true }
    : {
        success: false,
        error: `${command} exited with code ${result.exitCode}`,
      };
}

/**
 * Download the release binary for `latestVersion` and swap it into place at
 * `process.execPath`, falling back to `sudo mv` when a plain move is denied.
 */
export async function upgradeFromBinary(opts: {
  repo: string;
  latestVersion: string;
  binaryName: string;
  assetName?: (target: AssetTarget) => string;
  fetchImpl?: FetchLike;
  onProgress?: (message: string) => void;
}): Promise<InstallOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const onProgress = opts.onProgress ?? (() => {});

  const artifact = platformArtifactName({
    binaryName: opts.binaryName,
    assetName: opts.assetName,
  });
  const tag = `v${opts.latestVersion}`;
  const url = `https://github.com/${opts.repo}/releases/download/${tag}/${artifact}`;

  const tmpPath = join(tmpdir(), `${opts.binaryName}-upgrade-${Date.now()}`);
  const targetPath = process.execPath;

  try {
    const res = await doFetch(url);
    if (!res.ok) {
      return {
        success: false,
        error: `Failed to download binary: HTTP ${res.status}`,
      };
    }

    const bytes = await res.arrayBuffer();
    await Bun.write(tmpPath, bytes);

    await $`chmod +x ${tmpPath}`.quiet();

    // Try to move into place.
    const mv = await $`mv ${tmpPath} ${targetPath}`.quiet().nothrow();

    if (mv.exitCode !== 0) {
      // Fall back to sudo.
      onProgress("Requires elevated permissions...");
      const sudo = await $`sudo mv ${tmpPath} ${targetPath}`.nothrow();
      if (sudo.exitCode !== 0) {
        return {
          success: false,
          error: "Failed to install binary. Try running with sudo.",
        };
      }
    }

    return { success: true };
  } catch (err) {
    // Clean up temp file.
    await $`rm -f ${tmpPath}`.quiet().nothrow();
    return { success: false, error: `Failed to upgrade binary: ${err}` };
  }
}
