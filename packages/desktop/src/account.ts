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

/** Why a sign-in step failed, worded for the person at the screen. */
export class SignInError extends Error {}

const OFFLINE = "Couldn't reach Solus. Check your connection and try again.";
const SERVER = "Something went wrong on our side. Try again in a minute.";
const TOO_MANY = "Too many tries. Wait a minute, then try again.";

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Email codes through Supabase Auth. One flow covers sign-up and sign-in. */
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

  async sendCode(email: string): Promise<void> {
    if (!validEmail(email)) throw new SignInError("Enter a valid email address.");
    const res = await this.post("otp", { email, create_user: true });
    if (res.ok) return;
    if (res.status === 429) throw new SignInError(TOO_MANY);
    if (res.status < 500) throw new SignInError("Solus couldn't send a code to that address.");
    throw new SignInError(SERVER);
  }

  async verifyCode(email: string, code: string): Promise<Account> {
    const token = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) throw new SignInError("Enter the code from your email.");
    const res = await this.post("verify", { type: "email", email, token });
    if (res.status === 429) throw new SignInError(TOO_MANY);
    if (res.status >= 500) throw new SignInError(SERVER);
    if (!res.ok) throw new SignInError("That code is wrong or has expired.");
    const session = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      user?: { id?: string; email?: string };
    };
    if (!session.access_token || !session.refresh_token || !session.user?.id) throw new SignInError(SERVER);
    return {
      userId: session.user.id,
      email: session.user.email ?? email,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  }

  /** Ends the session on the server too. Signing out here works either way. */
  async signOut(account: Account): Promise<void> {
    await this.post("logout", {}, account.accessToken).catch(() => undefined);
  }
}
