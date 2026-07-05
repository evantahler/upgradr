# upgradr

Self-update for [Bun](https://bun.sh) & [Node](https://nodejs.org) CLIs. `upgradr`
checks npm for a newer release, shows a non-blocking startup notice, and upgrades
your tool in place — via `npm`/`bun` global install or by swapping a GitHub release
binary.

It's the mechanism extracted from [Botholomew](https://github.com/evantahler/botholomew),
generalized so any Bun or Node CLI can drop it in.

## Features

- **Version check** against the npm registry, with a GitHub-releases changelog.
- **Cached background notice** — a throttled "update available" line on startup, shown only in a TTY, with an env-var opt-out.
- **`upgrade` that always re-checks** — an explicit upgrade never trusts a stale cache.
- **Four install methods, auto-detected** — `npm` / `bun` global installs, a compiled release **binary** (downloaded + swapped in place, with `sudo` fallback), and `local-dev` (source checkout → no-op).
- **No framework coupling** — a `createUpdater(config)` factory returns plain async methods. Bring your own CLI (Commander, etc.). The library never writes to the console or exits the process; you own presentation.

## Install

```sh
bun add upgradr
# or
npm install upgradr
```

Runs on both Bun and Node (≥18). The package publishes compiled ESM (`dist/`), so
Node projects consume it like any other library — no Bun runtime required.

## Usage

Create one updater for your CLI, wired to your `package.json` and config dir:

```ts
import { createUpdater } from "upgradr";
import pkg from "./package.json" with { type: "json" };
import { homedir } from "node:os";
import { join } from "node:path";

export const updater = createUpdater({
  currentVersion: pkg.version,
  packageName: pkg.name,             // npm registry + `install -g <pkg>@<v>`
  repo: "you/your-cli",              // GitHub "owner/name" for release binaries + changelog
  binaryName: "your-cli",            // release asset prefix: your-cli-<os>-<arch>[.exe]
  cacheDir: join(homedir(), ".your-cli"),
  cliName: "your-cli",               // shown in notices / "Run `your-cli upgrade`"
  noUpdateCheckEnv: "YOUR_CLI_NO_UPDATE_CHECK",
});
```

### Startup notice (non-blocking)

```ts
// Kick off the check before parsing, print the notice after.
const notice = updater.maybeBackgroundNotice();
program.parse();
notice.then((msg) => {
  if (msg) process.stderr.write(msg);
});
```

### `check-update` command

```ts
const info = await updater.checkForUpdate();
if (info.hasUpdate) {
  console.log(`Update available: ${info.currentVersion} → ${info.latestVersion}`);
  if (info.changelog) console.log(info.changelog);
} else if (info.aheadOfLatest) {
  console.log(`Running ahead of the latest published release (v${info.latestVersion})`);
} else {
  console.log(`Up to date (v${info.currentVersion})`);
}
```

### `upgrade` command

```ts
const result = await updater.upgrade(); // always performs a fresh check first

if (!result.hasUpdate) {
  console.log(`Already up to date (v${result.from})`);
} else if (result.method === "local-dev") {
  console.log("Running from source. Use `git pull && bun install` to update.");
} else if (result.success) {
  console.log(`Upgraded ${result.from} → ${result.to} (${result.method})`);
} else {
  console.error(result.error ?? "Upgrade failed");
  process.exit(1);
}
```

## Configuration

| Option | Required | Default | Purpose |
| --- | --- | --- | --- |
| `currentVersion` | ✓ | — | The running version. |
| `packageName` | ✓ | — | npm package name (registry lookup + global install target). |
| `repo` | ✓ | — | GitHub `"owner/name"` for release binaries + changelog. |
| `binaryName` | ✓ | — | Release asset prefix → `<binaryName>-<os>-<arch>[.exe]`. |
| `cacheDir` | ✓ | — | Directory holding the `update.json` check cache. |
| `cliName` | | `packageName` | Display name in notices / upgrade hint. |
| `noUpdateCheckEnv` | | — | Env var that disables the background check when set to `"1"`. |
| `localDevEntry` | | `"src/cli.ts"` | Entry-script substring marking a source checkout. |
| `checkIntervalMs` | | 24h | How long a cached check stays fresh. |
| `timeoutMs` | | 5000 | Timeout for the background network check. |
| `backgroundSkipCommands` | | `["check-update","upgrade"]` | Commands that suppress the startup notice. |
| `formatNotice` | | built-in | `(ctx) => string` to fully render the startup notice. |
| `assetName` | | — | `(target) => string` to fully override the release asset name. |
| `fetchImpl` | | global `fetch` | Injectable `fetch` (for testing). |
| `onProgress` | | no-op | Progress callback (e.g. the sudo heads-up during a binary swap). |

## Customizing the notice

By default the startup notice is a yellow "Update available" header, an optional
dimmed changelog, and a cyan `Run <cli> upgrade` hint. Pass `formatNotice` to render
it yourself — you get the update details and return the whole string. The built-in
renderer is exported, so you can compose with it:

```ts
import { createUpdater, formatNotice } from "upgradr";

const updater = createUpdater({
  // …required config…
  formatNotice: (ctx) =>
    `${formatNotice(ctx)}\n  (docs: https://example.com/changelog)\n`,
});
```

`ctx` is `{ currentVersion, latestVersion, changelog?, cliName }`.

## Install-method detection

`detectInstallMethod()` inspects `process.argv[1]` and `process.execPath`:

- **`local-dev`** — running your source entry (`localDevEntry`) outside `node_modules`. `upgrade()` is a no-op here.
- **`binary`** — the exec path is a compiled binary (not `bun`/`node`). Upgraded by downloading the matching GitHub release asset and swapping it into place.
- **`bun`** — installed under `.bun/install` or `.bun/bin`. Upgraded with `bun install -g`.
- **`npm`** — the `node_modules` fallback. Upgraded with `npm install -g`.

## Producing the release artifacts upgradr expects

upgradr doesn't build or publish anything — it *consumes* what your CI already
produces. For each upgrade path to work, your repo must publish the matching
artifact:

| Upgrade path | What upgradr does | What your repo must publish |
| --- | --- | --- |
| `npm` / `bun` | `npm\|bun install -g <packageName>@<latestVersion>` | The package on **npm** at that version. |
| `binary` | `GET https://github.com/<repo>/releases/download/v<version>/<asset>` | A **GitHub release** tagged `v<version>` with an asset per platform. |
| `check-update` notice | reads npm for the version, GitHub releases for the changelog | Published npm versions + GitHub releases (release **notes** become the changelog). |

**The version check reads npm**, so you must publish to npm even if your primary
distribution is a binary. **The changelog reads GitHub releases**, so tag and
release on GitHub too.

### Required asset names

The `binary` path downloads exactly:

```
https://github.com/<repo>/releases/download/v<version>/<binaryName>-<os>-<arch>[.exe]
```

- `<os>` ∈ `darwin` | `linux` | `windows`
- `<arch>` ∈ `arm64` | `x64`
- `.exe` suffix on Windows only

So a v1.2.3 release of `binaryName: "your-cli"` needs assets like
`your-cli-darwin-arm64`, `your-cli-linux-x64`, `your-cli-windows-x64.exe`.
(Ship a different scheme? Override `assetName` in the config.)

### Example release workflow

Trigger a release when `package.json`'s `version` changes on `main`: create the
tag + GitHub release, build a binary per platform, upload each under the name
above, and publish to npm.

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: write   # create releases + upload assets
  id-token: write   # npm provenance
jobs:
  release:
    runs-on: ubuntu-latest
    outputs:
      tag: v${{ steps.v.outputs.version }}
      new: ${{ steps.v.outputs.new }}
    steps:
      - uses: actions/checkout@v4
      - id: v
        run: |
          V=$(jq -r .version package.json)
          echo "version=$V" >> "$GITHUB_OUTPUT"
          gh release view "v$V" >/dev/null 2>&1 && echo "new=false" >> "$GITHUB_OUTPUT" || echo "new=true" >> "$GITHUB_OUTPUT"
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
      - if: steps.v.outputs.new == 'true'
        run: gh release create "v${{ steps.v.outputs.version }}" --generate-notes
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }

  binaries:
    needs: release
    if: needs.release.outputs.new == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: macos-latest,   target: darwin-arm64, ext: "" }
          - { os: ubuntu-latest,  target: linux-x64,    ext: "" }
          - { os: windows-latest, target: windows-x64,  ext: ".exe" }
    runs-on: ${{ matrix.os }}
    defaults: { run: { shell: bash } }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun build --compile ./src/cli.ts --outfile "dist/your-cli${{ matrix.ext }}"
      - name: Upload asset (name MUST match what upgradr downloads)
        env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
        run: |
          asset="your-cli-${{ matrix.target }}${{ matrix.ext }}"
          cp "dist/your-cli${{ matrix.ext }}" "$asset"
          gh release upload "${{ needs.release.outputs.tag }}" "$asset" --clobber

  npm:
    needs: release
    if: needs.release.outputs.new == 'true'
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", registry-url: "https://registry.npmjs.org" }
      - run: npm publish --provenance --access public
        env: { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" }
```

**Repo setup checklist**

1. Authenticate npm publishing. Preferred: **trusted publishing (OIDC)** — configure a trusted publisher for your package on npmjs.com pointing at this repo + workflow, keep `id-token: write`, use npm ≥ 11.5.1, and drop `NODE_AUTH_TOKEN` entirely (as this repo's own `release.yml` does). Alternative: an `NPM_TOKEN` automation-token secret + `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
2. Allow Actions to write releases — `Settings → Actions → General → Workflow permissions → Read and write` (or the per-job `permissions:` above).
3. For provenance, keep `id-token: write` on the publish job and publish from CI (not locally).
4. First install for users is a shell one-liner that pulls the same assets:
   `curl -fsSL https://github.com/<repo>/releases/latest/download/<binaryName>-$(uname -s)-$(uname -m) -o your-cli` (normalize `uname` output to the `darwin|linux` / `arm64|x64` names above).

## API

`createUpdater(config)` returns an `Updater` with:
`checkForUpdate(signal?)`, `needsCheck(cache?)`, `detectInstallMethod()`,
`loadCache()`, `saveCache(cache)`, `clearCache()`, `maybeBackgroundNotice(overrides?)`,
and `upgrade()`. The standalone helpers `isNewerVersion`, `fetchLatestVersion`,
`fetchChangelog`, `platformArtifactName`, and `formatNotice` are also exported.

## License

MIT © Evan Tahler
