// Stages what ships in the app: the static UI, one bundled main process, and its
// two runtime dependencies, installed flat so electron-builder needn't read pnpm's layout.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const stage = join(here, "stage");
const webApp = join(here, "../../apps/web");
const { version, license } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const { dependencies } = JSON.parse(readFileSync(join(here, "../cli/package.json"), "utf8"));

try {
  process.loadEnvFile(join(here, ".env.local"));
} catch {
  // No local settings, as for anyone building from source.
}
// Both are public. Without them the app needs no account.
const { SOLUS_SUPABASE_URL: url, SOLUS_SUPABASE_PUBLISHABLE_KEY: key } = process.env;
const auth = url && key ? { url, key } : null;

rmSync(stage, { recursive: true, force: true });
rmSync(join(webApp, "out"), { recursive: true, force: true });
mkdirSync(stage);

execFileSync("pnpm", ["exec", "next", "build"], {
  cwd: webApp,
  stdio: "inherit",
  env: { ...process.env, SOLUS_PACKAGED: "1", NEXT_PUBLIC_SOLUS_PACKAGED: "1" },
});
cpSync(join(webApp, "out"), join(stage, "web"), { recursive: true });

await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(stage, "dist/main.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["electron", "node-pty", "ws"],
  define: { __SOLUS_AUTH__: JSON.stringify(auth) },
});
// Agents run this file directly, so it ships beside the bundle.
cpSync(join(here, "../runner-local/src/agents/mcp-bridge.mjs"), join(stage, "dist/mcp-bridge.mjs"));

writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({ name: "solus", productName: "Solus", version, license, type: "module", main: "dist/main.mjs", dependencies }, null, 2),
);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });
// Set here, because changing it at runtime would break the app's code signature.
for (const arch of ["darwin-arm64", "darwin-x64"]) {
  chmodSync(join(stage, "node_modules/node-pty/prebuilds", arch, "spawn-helper"), 0o755);
}
