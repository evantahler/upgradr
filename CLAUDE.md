# CLAUDE.md

## Project

`upgradr` is a framework-agnostic self-update utility for Bun CLIs. It checks for newer
releases in the background, caches an update notice, and can upgrade the tool in place.
The primary API is the factory `createUpdater(config)`; standalone helpers
(`checkForUpdate`, `upgrade`, `isNewerVersion`, `fetchLatestVersion`, `fetchChangelog`)
are also exported. It has no side effects — the calling CLI owns all presentation.

## Commands

- `bun test` — run the test suite (Bun's built-in test runner)
- `bun run lint` — `tsc --noEmit && biome check .`
- `bun run format` — `biome check --write .`

## Keep the repo small

This is the guiding principle. A small repo stays easy to read, audit, and trust.

- **Minimize dependencies.** There is currently 1 runtime dependency (`ansis`). Adding a
  runtime dependency requires a strong justification — prefer the Bun/Node standard
  library or a few lines of local code over pulling in a package.
- **Keep the public API tight.** Don't add exports, options, or config knobs
  speculatively. Add them when a real use case demands it.
- **No new top-level files or directories without cause.** Don't commit generated
  artifacts or build output.
- **Keep source files small and focused.** One clear responsibility per file in `src/`.

## Always test everything

Every change is verified — no exceptions.

- **Every change ships with tests.** Features and fixes both land with tests in `test/`.
- **Bug fixes start with a failing test** that reproduces the bug, then the fix.
- **`bun test` and `bun run lint` must both pass** before work is considered done.
- **Don't weaken or delete tests** to make a suite go green.

## Bump the version

Any meaningful change to code requires a version bump in `package.json` (follow semver).
Pushing to `main` with a new version triggers the release workflow, which creates a
GitHub release and publishes to npm.

## Structure

```
src/            # source (index, config, checker, upgrade, cache, notice)
test/           # test suite (bun test)
.github/workflows/
  ci.yml        # lint + test on push/PR
  release.yml   # build binaries, publish to npm, create GitHub release
biome.json      # formatter + linter config
tsconfig.json   # strict TypeScript config
```
