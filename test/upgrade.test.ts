import { describe, expect, test } from "bun:test";
import {
  platformArtifactName,
  upgradeWithPackageManager,
} from "../src/upgrade.ts";

describe("platformArtifactName", () => {
  test("darwin arm64", () => {
    expect(
      platformArtifactName({
        binaryName: "app",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toBe("app-darwin-arm64");
  });
  test("linux x64", () => {
    expect(
      platformArtifactName({
        binaryName: "app",
        platform: "linux",
        arch: "x64",
      }),
    ).toBe("app-linux-x64");
  });
  test("windows gets .exe and normalizes arch", () => {
    expect(
      platformArtifactName({
        binaryName: "app",
        platform: "win32",
        arch: "ia32",
      }),
    ).toBe("app-windows-x64.exe");
  });
  test("assetName override wins", () => {
    expect(
      platformArtifactName({
        binaryName: "app",
        platform: "darwin",
        arch: "arm64",
        assetName: ({ platform, arch }) => `custom_${platform}_${arch}.tar.gz`,
      }),
    ).toBe("custom_darwin_arm64.tar.gz");
  });
});

describe("upgradeWithPackageManager", () => {
  test("succeeds on exit code 0", async () => {
    expect(await upgradeWithPackageManager("sh", ["-c", "exit 0"])).toEqual({
      success: true,
    });
  });

  test("failure includes the exact command and the stderr output", async () => {
    const script =
      'echo noise; echo "error: No version matching \\"0.11.0\\" found" >&2; exit 1';
    const outcome = await upgradeWithPackageManager("sh", ["-c", script]);
    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe(
      `sh -c ${script} exited with code 1:\nerror: No version matching "0.11.0" found`,
    );
  });

  test("falls back to stdout when stderr is empty", async () => {
    const outcome = await upgradeWithPackageManager("sh", [
      "-c",
      "echo only-stdout; exit 2",
    ]);
    expect(outcome.error).toEndWith("exited with code 2:\nonly-stdout");
  });

  test("keeps only the tail of long output", async () => {
    const outcome = await upgradeWithPackageManager("sh", [
      "-c",
      "for i in $(seq 1 30); do echo line$i >&2; done; exit 1",
    ]);
    const lines = outcome.error?.split("\n") ?? [];
    expect(lines).toHaveLength(11);
    expect(lines[1]).toBe("line21");
    expect(lines[10]).toBe("line30");
  });

  test("reports a missing command instead of a bare exit code", async () => {
    const outcome = await upgradeWithPackageManager("upgradr-no-such-cmd", [
      "install",
    ]);
    expect(outcome.success).toBe(false);
    expect(outcome.error).toStartWith("upgradr-no-such-cmd install failed:");
  });
});
