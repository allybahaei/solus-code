import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Account } from "./account";

/** Encrypts with the operating system. Electron's safeStorage fits this. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

function isAccount(value: unknown): value is Account {
  const a = value as Partial<Account> | null;
  return typeof a?.userId === "string" && typeof a.email === "string" && typeof a.accessToken === "string" && typeof a.refreshToken === "string";
}

/** Nothing is ever written unencrypted: without a cipher the session lasts until quit. */
export function saveAccount(file: string, account: Account, cipher: Cipher): void {
  if (!cipher.isEncryptionAvailable()) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, cipher.encryptString(JSON.stringify(account)), { mode: 0o600 });
}

export function loadAccount(file: string, cipher: Cipher): Account | undefined {
  try {
    const parsed: unknown = JSON.parse(cipher.decryptString(readFileSync(file)));
    return isAccount(parsed) ? parsed : undefined;
  } catch {
    return undefined; // Missing or unreadable: the person signs in again.
  }
}

export function clearAccount(file: string): void {
  rmSync(file, { force: true });
}
