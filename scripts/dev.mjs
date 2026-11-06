// `pnpm dev`: the daemon and the web app together, sharing a fresh token.
// Flags: --repo <path> (a real repo; add --fake for the fake agent), --port <web port>, --daemon-port <port>,
// and for the mock: --autopilot, --speed <n>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    fake: { type: "boolean", default: false },
    port: { type: "string", default: "3000" },
    "daemon-port": { type: "string", default: "4317" },
    autopilot: { type: "boolean", default: false },
    speed: { type: "string", default: "1" },
  },
});

const token = randomBytes(24).toString("hex");
const daemonPort = values["daemon-port"];
const env = {
  ...process.env,
  SOLUS_TOKEN: token,
  NEXT_PUBLIC_SOLUS_TOKEN: token,
  NEXT_PUBLIC_SOLUS_DAEMON_URL: `ws://127.0.0.1:${daemonPort}`,
};

const daemonArgs = [
  "--port", daemonPort,
  "--speed", values.speed,
  ...(values.autopilot ? ["--autopilot"] : []),
  ...(values.repo ? ["--repo", resolve(values.repo)] : []),
  ...(values.fake ? ["--fake"] : []),
];
const children = [
  spawn("pnpm", ["--filter", "@solus/daemon", "dev", ...daemonArgs], { env, stdio: "inherit" }),
  spawn("pnpm", ["--filter", "web", "dev", "--port", values.port], { env, stdio: "inherit" }),
];

const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", stop);
