import { describe, expect, it } from "vitest";
import { SignInError } from "./account";
import { listenForCode } from "./callback";

let nextPort = 47900;
const url = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

describe("listenForCode", () => {
  it("hands over the code, tells the browser, then closes", async () => {
    const port = nextPort++;
    const pending = await listenForCode(port, async (code) => `account for ${code}`);
    const res = await fetch(url(port, "/callback?code=abc"));
    expect(await res.text()).toContain("You're signed in");
    await expect(pending.result).resolves.toBe("account for abc");
    await expect(fetch(url(port, "/callback?code=abc"))).rejects.toThrow();
  });

  it("ignores other paths and keeps waiting", async () => {
    const port = nextPort++;
    const pending = await listenForCode(port, async (code) => code);
    expect((await fetch(url(port, "/favicon.ico"))).status).toBe(404);
    await fetch(url(port, "/callback?code=still-here"));
    await expect(pending.result).resolves.toBe("still-here");
  });

  it("fails when GitHub sends the person back without a code", async () => {
    const port = nextPort++;
    const pending = await listenForCode(port, async (code) => code);
    const failed = expect(pending.result).rejects.toBeInstanceOf(SignInError);
    const res = await fetch(url(port, "/callback?error=access_denied"));
    expect(res.status).toBe(400);
    await failed;
  });

  it("fails when the code can't be exchanged, and says so in the browser", async () => {
    const port = nextPort++;
    const pending = await listenForCode(port, async () => {
      throw new SignInError("refused");
    });
    const failed = expect(pending.result).rejects.toThrow("refused");
    expect(await (await fetch(url(port, "/callback?code=bad"))).text()).toContain("didn't finish");
    await failed;
  });

  it("can be cancelled, and stops on its own after a while", async () => {
    const first = nextPort++;
    const pending = await listenForCode(first, async (code) => code);
    pending.cancel();
    await expect(pending.result).rejects.toThrow("cancelled");

    const late = await listenForCode(nextPort++, async (code) => code, 10);
    await expect(late.result).rejects.toThrow("cancelled");
  });

  it("explains a port that's already taken", async () => {
    const port = nextPort++;
    const pending = await listenForCode(port, async (code) => code);
    await expect(listenForCode(port, async (code) => code)).rejects.toThrow("in use");
    pending.cancel();
    await pending.result.catch(() => undefined);
  });
});
