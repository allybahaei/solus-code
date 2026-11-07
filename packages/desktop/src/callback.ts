import { createServer, type ServerResponse } from "node:http";
import { SignInCancelled, SignInError } from "./account";

const TIMEOUT_MS = 5 * 60_000;

/** What the browser tab shows when it comes back. */
function finishedPage(heading: string, detail: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Solus</title><style>
:root { color-scheme: light dark; } body { height: 100vh; margin: 0; display: grid; place-content: center; text-align: center;
font: 15px/1.5 -apple-system, system-ui, sans-serif; } h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; } p { margin: 0; opacity: 0.65; }
</style><h1>${heading}</h1><p>${detail}</p>`;
}

export interface PendingCallback<T> {
  result: Promise<T>;
  /** Stops waiting. The result then fails with a SignInCancelled. */
  cancel: () => void;
}

/**
 * Waits on this machine for the browser to come back from sign-in. Takes the
 * first code it's given, hands it to `exchange`, then closes.
 */
export async function listenForCode<T>(
  port: number,
  exchange: (code: string) => Promise<T>,
  timeoutMs = TIMEOUT_MS,
): Promise<PendingCallback<T>> {
  let finish: (run: () => void) => void = () => {};
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "EADDRINUSE" ? new SignInError(`Port ${port} is in use, so Solus can't finish signing in.`) : err),
    );
    server.listen(port, "127.0.0.1", resolve);
  });

  let cancel = () => {};
  const result = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => cancel(), timeoutMs);
    finish = (run) => {
      clearTimeout(timer);
      server.closeAllConnections();
      server.close(() => run()); // After the port is free, so a retry can take it.
    };
    cancel = () => finish(() => reject(new SignInCancelled("Sign-in was cancelled.")));

    const reply = (res: ServerResponse, status: number, heading: string, detail: string, done: () => void) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
      res.end(finishedPage(heading, detail), () => finish(done));
    };

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") return void res.writeHead(404).end();
      const code = url.searchParams.get("code");
      if (!code) {
        const error = new SignInError("GitHub sign-in didn't finish. Try again.");
        return reply(res, 400, "Sign-in didn't finish", "Go back to Solus to try again.", () => reject(error));
      }
      exchange(code).then(
        (value) => reply(res, 200, "You're signed in", "You can close this tab and go back to Solus.", () => resolve(value)),
        (err: unknown) => reply(res, 400, "Sign-in didn't finish", "Go back to Solus to try again.", () => reject(err)),
      );
    });
  });

  return { result, cancel };
}
