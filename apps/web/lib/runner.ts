"use client";

import type { Runner } from "@solus/core";
import { RemoteRunner } from "@solus/runner-client";
import { MOCK_BASE_BRANCH, MOCK_REPO, createMockRunner } from "@solus/runner-mock";
import type { ConnectionSource } from "./store";

/** The repo the prototype shows. Comes from the runner once there is a real one. */
export const REPO = MOCK_REPO;
export const BASE_BRANCH = MOCK_BASE_BRANCH;

const DAEMON_URL = process.env.NEXT_PUBLIC_SOLUS_DAEMON_URL;
const DAEMON_TOKEN = process.env.NEXT_PUBLIC_SOLUS_TOKEN ?? "";

let runner: Runner | null = null;
let connection: ConnectionSource | undefined;

/**
 * One runner per browser tab. The UI only sees the Runner interface.
 *
 * `pnpm dev` sets the daemon URL, so tasks live in the daemon. `pnpm dev:web`
 * doesn't, so a mock runs inside the page instead, for UI work. Query params
 * for that mode: ?autopilot plays the user too, ?speed=2 doubles the pace.
 */
export function getRunner(): Runner {
  if (runner) return runner;
  if (DAEMON_URL) {
    const remote = new RemoteRunner({ url: DAEMON_URL, token: DAEMON_TOKEN });
    connection = remote;
    runner = remote;
  } else {
    const params = new URLSearchParams(window.location.search);
    runner = createMockRunner({
      autopilot: params.has("autopilot"),
      speed: Number(params.get("speed")) || 1,
    });
  }
  return runner;
}

export function getConnection(): ConnectionSource | undefined {
  getRunner();
  return connection;
}
