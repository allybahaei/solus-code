import { createHash, randomBytes } from "node:crypto";

const TIMEOUT_MS = 15_000;

export interface Account {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface AuthConfig {
  /** The Supabase project URL. */
  url: string;
  /** Its publishable key, which is public. */
  key: string;
}

/** Why sign-in failed, worded for the person at the screen. */
export class SignInError extends Error {}

/** The person stopped, or it ran out of time. Not worth an error message. */
export class SignInCancelled extends SignInError {}

const OFFLINE = "Couldn't reach Solus. Check your connection and try again.";
const UNFINISHED = "Sign-in didn't finish. Try again.";

/** PKCE: only the app holding the verifier can finish a sign-in it started. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** GitHub sign-in through Supabase Auth, which also creates the account. */
export class AccountClient {
  constructor(
    private readonly config: AuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown, token?: string): Promise<Response> {
    try {
      return await this.request(`${this.config.url}/auth/v1/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new SignInError(OFFLINE, { cause: err });
    }
  }

  /** The page to open in the person's browser. */
  authorizeUrl(redirectTo: string, challenge: string): string {
    const params = new URLSearchParams({
      provider: "github",
      redirect_to: redirectTo,
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
    return `${this.config.url}/auth/v1/authorize?${params}`;
  }

  async exchangeCode(code: string, verifier: string): Promise<Account> {
    const res = await this.post("token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
    if (!res.ok) throw new SignInError(UNFINISHED);
    const session = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      user?: { id?: string; email?: string };
    };
    if (!session.access_token || !session.refresh_token || !session.user?.id) throw new SignInError(UNFINISHED);
    return {
      userId: session.user.id,
      email: session.user.email ?? "",
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }

  /** Ends the session on the server too. Signing out here works either way. */
  async signOut(account: Account): Promise<void> {
    await this.post("logout", {}, account.accessToken).catch(() => undefined);
  }
}
