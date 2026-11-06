// Builds what ships: the static UI in web/, and one bundled command in dist/.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "../../apps/web");
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

rmSync(join(here, "dist"), { recursive: true, force: true });
rmSync(join(here, "web"), { recursive: true, force: true });
rmSync(join(webApp, "out"), { recursive: true, force: true });

execFileSync("pnpm", ["exec", "next", "build"], {
  cwd: webApp,
  stdio: "inherit",
  env: { ...process.env, SOLUS_PACKAGED: "1", NEXT_PUBLIC_SOLUS_PACKAGED: "1" },
});
cpSync(join(webApp, "out"), join(here, "web"), { recursive: true });

await build({
  entryPoints: [join(here, "src/main.ts")],
  outfile: join(here, "dist/cli.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // node-pty is native. ws is CommonJS, which doesn't bundle cleanly into ESM.
  external: ["node-pty", "ws"],
  banner: { js: "#!/usr/bin/env node" },
  define: { __SOLUS_VERSION__: JSON.stringify(version) },
});
// Agents run this file directly, so it ships beside the bundle.
cpSync(join(here, "../runner-local/src/agents/mcp-bridge.mjs"), join(here, "dist/mcp-bridge.mjs"));
