import { describe, expect, it, vi } from "vitest";
import { AccountClient, SignInError, validEmail } from "./account";

const config = { url: "https://auth.test", key: "public-key" };
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const client = (response: Response | Error) => {
  const request = vi.fn<typeof fetch>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  return { request, accounts: new AccountClient(config, request) };
};
const session = { access_token: "a", refresh_token: "r", user: { id: "u1", email: "me@example.com" } };

describe("validEmail", () => {
  it("accepts a normal address and refuses others", () => {
    expect(validEmail("me@example.com")).toBe(true);
    expect(validEmail("me@example")).toBe(false);
    expect(validEmail("not an email@example.com")).toBe(false);
  });
});

describe("sendCode", () => {
  it("asks for a code that also creates the account", async () => {
    const { request, accounts } = client(reply(200));
    await accounts.sendCode("me@example.com");
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe("https://auth.test/auth/v1/otp");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "me@example.com", create_user: true });
    expect(new Headers(init?.headers).get("apikey")).toBe("public-key");
  });

  it("doesn't call the server for a bad address", async () => {
    const { request, accounts } = client(reply(200));
    await expect(accounts.sendCode("nope")).rejects.toThrow("valid email");
    expect(request).not.toHaveBeenCalled();
  });

  it("explains being offline, rate limits and server errors", async () => {
    await expect(client(new TypeError("fetch failed")).accounts.sendCode("me@example.com")).rejects.toThrow("connection");
    await expect(client(reply(429)).accounts.sendCode("me@example.com")).rejects.toThrow("Too many");
    await expect(client(reply(503)).accounts.sendCode("me@example.com")).rejects.toThrow("our side");
  });
});

describe("verifyCode", () => {
  it("returns the account, ignoring spaces in the code", async () => {
    const { request, accounts } = client(reply(200, session));
    await expect(accounts.verifyCode("me@example.com", "123 456")).resolves.toEqual({
      userId: "u1",
      email: "me@example.com",
      accessToken: "a",
      refreshToken: "r",
    });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ type: "email", email: "me@example.com", token: "123456" });
  });

  it("refuses something that isn't a code without calling the server", async () => {
    const { request, accounts } = client(reply(200, session));
    await expect(accounts.verifyCode("me@example.com", "abc")).rejects.toBeInstanceOf(SignInError);
    expect(request).not.toHaveBeenCalled();
  });

  it("says when a code is wrong or expired", async () => {
    await expect(client(reply(403)).accounts.verifyCode("me@example.com", "123456")).rejects.toThrow("wrong or has expired");
  });

  it("treats a reply with no session as a server problem", async () => {
    await expect(client(reply(200, {})).accounts.verifyCode("me@example.com", "123456")).rejects.toThrow("our side");
  });
});

describe("signOut", () => {
  it("doesn't fail when the server can't be reached", async () => {
    const account = { userId: "u", email: "e", accessToken: "a", refreshToken: "r" };
    await expect(client(new TypeError("offline")).accounts.signOut(account)).resolves.toBeUndefined();
  });

  it("sends the session's token", async () => {
    const { request, accounts } = client(reply(200));
    await accounts.signOut({ userId: "u", email: "e", accessToken: "a", refreshToken: "r" });
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer a");
  });
});
