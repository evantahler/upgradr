import { execFile } from "node:child_process";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AssetTarget, FetchLike } from "./config.ts";

const execFileAsync = promisify(execFile);

/** Outcome of a binary or package-manager install attempt. */
export interface InstallOutcome {
  success: boolean;
  error?: string;
}

/**
 * Run a command without throwing, returning its exit code. Cross-runtime
 * (Node + Bun) replacement for Bun's `$`…`.nothrow()`.
 */
async function run(
  command: string,
  args: string[],
): Promise<{ exitCode: number }> {
  try {
    await execFileAsync(command, args);
    return { exitCode: 0 };
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    return { exitCode: typeof code === "number" ? code : 1 };
  }
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
  const result = await run(command, args);
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
    await writeFile(tmpPath, Buffer.from(bytes));

    await chmod(tmpPath, 0o755);

    // Try to move into place (mv handles cross-filesystem moves).
    const mv = await run("mv", [tmpPath, targetPath]);

    if (mv.exitCode !== 0) {
      // Fall back to sudo.
      onProgress("Requires elevated permissions...");
      const sudo = await run("sudo", ["mv", tmpPath, targetPath]);
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
    await unlink(tmpPath).catch(() => {});
    return { success: false, error: `Failed to upgrade binary: ${err}` };
  }
}
