import { describe, expect, it } from "vitest";
import { bridgeEnv } from "./tool-server";

describe("bridgeEnv", () => {
  it("makes the Mac app behave as Node when an agent starts the bridge", () => {
    expect(bridgeEnv({ ...process.versions, electron: "39.0.0" })).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("adds nothing under plain Node", () => {
    expect(bridgeEnv({ ...process.versions, electron: undefined } as unknown as NodeJS.ProcessVersions)).toEqual({});
  });
});
