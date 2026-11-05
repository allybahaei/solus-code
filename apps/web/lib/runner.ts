"use client";

import type { Runner } from "@solus/core";
import { MOCK_BASE_BRANCH, MOCK_REPO, createMockRunner } from "@solus/runner-mock";

/** The repo the prototype shows. Comes from the runner once there is a real one. */
export const REPO = MOCK_REPO;
export const BASE_BRANCH = MOCK_BASE_BRANCH;

let runner: Runner | null = null;

/**
 * One runner per browser tab. The UI only sees the Runner interface, so
 * swapping in runner-local later doesn't touch components.
 *
 * Query params for the prototype: ?autopilot plays the user too,
 * ?speed=2 runs the scripts twice as fast.
 */
export function getRunner(): Runner {
  if (!runner) {
    const params = new URLSearchParams(window.location.search);
    runner = createMockRunner({
      autopilot: params.has("autopilot"),
      speed: Number(params.get("speed")) || 1,
    });
  }
  return runner;
}
