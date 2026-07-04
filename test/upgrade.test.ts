import { describe, expect, test } from "bun:test";
import { platformArtifactName } from "../src/upgrade.ts";

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
