import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AccountClient, pkcePair } from "./account";

const config = { url: "https://auth.test", key: "public-key" };
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const client = (response: Response | Error) => {
  const request = vi.fn<typeof fetch>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  return { request, accounts: new AccountClient(config, request) };
};
const session = { access_token: "a", refresh_token: "r", user: { id: "u1", email: "me@example.com" } };

describe("pkcePair", () => {
  it("makes a challenge from a fresh verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkcePair().verifier).not.toBe(verifier);
  });
});

describe("authorizeUrl", () => {
  it("asks for GitHub, sends the challenge and comes back here", () => {
    const url = new URL(client(reply(200)).accounts.authorizeUrl("http://127.0.0.1:47831/callback", "abc"));
    expect(url.origin + url.pathname).toBe("https://auth.test/auth/v1/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      provider: "github",
      redirect_to: "http://127.0.0.1:47831/callback",
      code_challenge: "abc",
      code_challenge_method: "s256",
    });
  });
});

describe("exchangeCode", () => {
  it("returns the account and proves it started the sign-in", async () => {
    const { request, accounts } = client(reply(200, session));
    await expect(accounts.exchangeCode("code", "verifier")).resolves.toEqual({
      userId: "u1",
      email: "me@example.com",
      accessToken: "a",
      refreshToken: "r",
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe("https://auth.test/auth/v1/token?grant_type=pkce");
    expect(JSON.parse(String(init?.body))).toEqual({ auth_code: "code", code_verifier: "verifier" });
    expect(new Headers(init?.headers).get("apikey")).toBe("public-key");
  });

  it("explains a refused code, a reply with no session, and being offline", async () => {
    await expect(client(reply(404)).accounts.exchangeCode("c", "v")).rejects.toThrow("didn't finish");
    await expect(client(reply(200, {})).accounts.exchangeCode("c", "v")).rejects.toThrow("didn't finish");
    await expect(client(new TypeError("fetch failed")).accounts.exchangeCode("c", "v")).rejects.toThrow("connection");
  });
});

describe("signOut", () => {
  const account = { userId: "u", email: "e", accessToken: "a", refreshToken: "r" };

  it("doesn't fail when the server can't be reached", async () => {
    await expect(client(new TypeError("offline")).accounts.signOut(account)).resolves.toBeUndefined();
  });

  it("sends the session's token", async () => {
    const { request, accounts } = client(reply(200));
    await accounts.signOut(account);
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer a");
  });
});
