"use client";

import type { Runner } from "@solus/core";
import { RemoteRunner } from "@solus/runner-client";
import { createMockRunner } from "@solus/runner-mock";
import type { ConnectionSource } from "./store";

const TOKEN_KEY = "solus.token";

let runner: Runner | null = null;
let connection: ConnectionSource | undefined;

/**
 * The launch link carries the token after the #, which never reaches a server.
 * It moves to this tab's session storage so a refresh keeps working, and leaves
 * the address bar so it doesn't linger in history.
 */
function tokenFromPage(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("token");
  try {
    if (fromLink) {
      sessionStorage.setItem(TOKEN_KEY, fromLink);
      history.replaceState(null, "", window.location.pathname);
      return fromLink;
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return fromLink;
  }
}

function daemon(): { url: string; token: string } | null {
  // `pnpm dev` runs the web app and daemon separately and sets these.
  const url = process.env.NEXT_PUBLIC_SOLUS_DAEMON_URL;
  if (url) return { url, token: process.env.NEXT_PUBLIC_SOLUS_TOKEN ?? "" };

  // The packaged app is served by the daemon itself.
  const token = tokenFromPage();
  const sameHost = `ws://${window.location.host}`;
  if (token) return { url: sameHost, token };
  return process.env.NEXT_PUBLIC_SOLUS_PACKAGED ? { url: sameHost, token: "" } : null;
}

/**
 * One runner per browser tab. The UI only sees the Runner interface.
 *
 * With no daemon, as in `pnpm dev:web`, a mock runs inside the page, for UI
 * work. Query params for that mode: ?autopilot plays the user too, ?speed=2
 * doubles the pace.
 */
export function getRunner(): Runner {
  if (runner) return runner;
  const config = daemon();
  if (config) {
    const remote = new RemoteRunner(config);
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
