import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createMockRunner } from "@solus/runner-mock";
import { startDaemon } from "./server";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4317" },
    autopilot: { type: "boolean", default: false },
    speed: { type: "string", default: "1" },
  },
});

const token = process.env.SOLUS_TOKEN ?? randomBytes(24).toString("hex");
const runner = createMockRunner({ autopilot: values.autopilot, speed: Number(values.speed) || 1 });

try {
  const daemon = await startDaemon({ runner, token, port: Number(values.port) });
  console.log(`Solus daemon on 127.0.0.1:${daemon.port} (mock runner)`);

  const stop = () => {
    runner.dispose();
    void daemon.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  const inUse = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
  console.error(inUse ? `Port ${values.port} is already in use. Is another Solus daemon running?` : err);
  process.exit(1);
}
