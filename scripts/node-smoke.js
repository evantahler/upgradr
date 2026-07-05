// Smoke test: import the compiled package under plain Node.js and exercise a
// couple of exports. Guards against a Bun-only API sneaking back into src/.
// Run after `bun run build` via `node scripts/node-smoke.js` (see `bun run smoke`).
import { createUpdater, isNewerVersion } from "../dist/index.js";

function assert(ok, message) {
  if (!ok) {
    console.error(`node-smoke: ${message}`);
    process.exit(1);
  }
}

assert(typeof createUpdater === "function", "createUpdater is not a function");
assert(
  isNewerVersion("1.0.0", "1.0.1") === true,
  "isNewerVersion(1.0.0, 1.0.1) should be true",
);
assert(
  isNewerVersion("1.0.0", "1.0.0") === false,
  "isNewerVersion(1.0.0, 1.0.0) should be false",
);

const updater = createUpdater({
  packageName: "upgradr",
  repo: "evantahler/upgradr",
  currentVersion: "1.0.0",
  binaryName: "upgradr",
  cacheDir: "/tmp/upgradr-smoke",
});
assert(
  typeof updater.upgrade === "function",
  "updater.upgrade is not a function",
);

console.log("node-smoke: ok");
