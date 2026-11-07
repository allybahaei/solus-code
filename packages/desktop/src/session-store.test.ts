import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearAccount, loadAccount, saveAccount, type Cipher } from "./session-store";

const account = { userId: "u1", email: "me@example.com", accessToken: "secret-a", refreshToken: "secret-r" };
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text).reverse(),
  decryptString: (data) => Buffer.from(data).reverse().toString(),
};

const dirs: string[] = [];
function file() {
  const dir = mkdtempSync(join(tmpdir(), "solus-account-"));
  dirs.push(dir);
  return join(dir, "account.bin");
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("the saved account", () => {
  it("comes back after saving, and is private and not plain text", () => {
    const path = file();
    saveAccount(path, account, cipher);
    expect(loadAccount(path, cipher)).toEqual(account);
    expect(readFileSync(path, "utf8")).not.toContain("secret-a");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("is never written when encryption isn't available", () => {
    const path = file();
    saveAccount(path, account, { ...cipher, isEncryptionAvailable: () => false });
    expect(loadAccount(path, cipher)).toBeUndefined();
  });

  it("asks for sign-in again when missing, damaged or the wrong shape", () => {
    const path = file();
    expect(loadAccount(path, cipher)).toBeUndefined();
    writeFileSync(path, "garbage");
    expect(loadAccount(path, cipher)).toBeUndefined();
    writeFileSync(path, cipher.encryptString(JSON.stringify({ email: "x" })));
    expect(loadAccount(path, cipher)).toBeUndefined();
  });

  it("is gone after signing out", () => {
    const path = file();
    saveAccount(path, account, cipher);
    clearAccount(path);
    expect(loadAccount(path, cipher)).toBeUndefined();
    expect(() => clearAccount(path)).not.toThrow();
  });
});
