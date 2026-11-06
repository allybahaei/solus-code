// `pnpm dev`: the daemon and the web app together, sharing a fresh token.
// Flags: --repo <path> (a real repo; add --fake for the fake agent), --port <web port>, --daemon-port <port>,
// and for the mock: --autopilot, --speed <n>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    fake: { type: "boolean", default: false },
    port: { type: "string" },
    "daemon-port": { type: "string", default: "4317" },
    autopilot: { type: "boolean", default: false },
    speed: { type: "string", default: "1" },
  },
});

/** True if nothing is listening on the port, on any interface. */
const isFree = (port) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, () => probe.close(() => done(true)));
  });

/** The chosen port, or the first free one from 3000 up, since other apps often hold 3000. */
async function webPort() {
  if (values.port) return values.port;
  for (let port = 3000; port < 3100; port++) {
    if (await isFree(port)) return String(port);
  }
  throw new Error("No free port between 3000 and 3099.");
}

const port = await webPort();
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
  spawn("pnpm", ["--filter", "web", "dev", "--port", port], { env, stdio: "inherit" }),
];

console.log(`\nSolus: http://localhost:${port}\n`);

const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", stop);
