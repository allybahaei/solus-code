import { RunnerDebug } from "./runner-debug";

/**
 * Temporary: proves the web app is wired to runner-mock.
 * The task board replaces this page in the next step.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-sm font-medium">Solus</h1>
        <p className="text-sm text-muted-foreground">
          runner-mock on autopilot: scripted tasks moving through every state. Not the task board yet.
        </p>
      </header>
      <RunnerDebug />
    </main>
  );
}
