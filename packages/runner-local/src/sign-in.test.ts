import { describe, expect, it, vi } from "vitest";
import { openSignIn, signInCommand, signInScript } from "./sign-in";

describe("signInCommand", () => {
  it("knows each tool's own sign-in", () => {
    expect(signInCommand("claude-code")).toEqual(["claude", "auth", "login"]);
    expect(signInCommand("codex", { codex: "/opt/codex" })).toEqual(["/opt/codex", "login"]);
    expect(signInCommand("gh")).toEqual(["gh", "auth", "login"]);
  });

  it("knows nothing else", () => {
    expect(signInCommand("rm -rf /")).toBeUndefined();
    expect(signInCommand("opencode")).toBeUndefined();
  });
});

it("quotes every argument, so a path can't add commands", () => {
  const script = signInScript(["/Apps/My Tool's/bin", "login; rm -rf ~"]);
  expect(script).toContain(`'/Apps/My Tool'\\''s/bin' 'login; rm -rf ~'`);
});

describe("openSignIn", () => {
  const run = () => vi.fn(async () => ({ stdout: "", stderr: "" })) as unknown as Parameters<typeof openSignIn>[3] & ReturnType<typeof vi.fn>;

  it("opens a script in Terminal on macOS", async () => {
    const exec = run();
    await openSignIn("codex", {}, "darwin", exec);
    const [command, [file]] = exec.mock.calls[0] as [string, string[]];
    expect(command).toBe("open");
    expect(file).toMatch(/sign-in\.command$/);
  });

  it("refuses anything that isn't a known sign-in", async () => {
    const exec = run();
    await expect(openSignIn("anything", {}, "darwin", exec)).rejects.toThrow("can't sign in");
    expect(exec).not.toHaveBeenCalled();
  });

  it("says what to run elsewhere", async () => {
    await expect(openSignIn("gh", {}, "linux", run())).rejects.toThrow("gh auth login");
  });
});
