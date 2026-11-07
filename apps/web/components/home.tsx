"use client";

import { useEffect, useState } from "react";
import { Check, Copy, SquareTerminal } from "lucide-react";
import { isAttention, type AgentKind, type Task } from "@solus/core";
import { StateLabel } from "@/components/state-dot";
import { Button } from "@/components/ui/button";
import { installAgent, openSignIn, recheckSetup } from "@/lib/actions";
import { sidebarSections } from "@/lib/groups";
import { useSolus } from "@/lib/store";

/** Shown when no workspace is open: what needs you, then what's ready. */
export function Home() {
  const tasks = useSolus((s) => s.tasks);
  const pinned = useSolus((s) => s.pinned);
  const open = useSolus((s) => s.open);
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);
  const { pinned: p, workspaces } = sidebarSections(Object.values(tasks), pinned);
  const active = [...p, ...workspaces];
  const needsYou = active.filter((t) => isAttention(t.state));
  const ready = active.filter((t) => t.state === "ready_for_review");
  const working = active.filter((t) => t.state === "working").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold tracking-tight">
          {needsYou.length > 0
            ? `${needsYou.length} ${needsYou.length === 1 ? "workspace needs" : "workspaces need"} you`
            : "Nothing needs you right now"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {working} working · {ready.length} ready for review
        </p>

        <SetupNotice />

        <List title="Needs you" tasks={needsYou} onOpen={open} />
        <List title="Ready for review" tasks={ready} onOpen={open} />

        <button
          type="button"
          onClick={() => setNewTaskOpen(true)}
          className="mt-8 text-sm text-muted-foreground hover:text-foreground"
        >
          Start a new task <kbd className="ml-1 font-sans text-xs">N</kbd>
        </button>
      </div>
    </div>
  );
}

const STATE_TEXT = { missing: "Not installed", signed_out: "Not signed in", problem: "Needs attention", ready: "Ready" };

/** Shown only when something isn't ready, with the command that fixes it. */
function SetupNotice() {
  const setup = useSolus((s) => s.setup);
  const pending = !!setup && [...setup.agents, ...setup.tools].some((c) => c.state !== "ready");
  // Sign-ins finish elsewhere, so look again when the person comes back.
  useEffect(() => {
    if (!pending) return;
    let last = 0;
    const onReturn = () => {
      if (document.hidden || Date.now() - last < 3000) return;
      last = Date.now();
      void recheckSetup();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [pending]);
  if (!setup) return null;
  const checks = [...setup.agents, ...setup.tools];
  const problems = checks.filter((c) => c.state !== "ready");
  if (problems.length === 0) return null;
  const noAgent = setup.agents.every((a) => a.state !== "ready");
  const installable = new Map(setup.agents.filter((a) => a.installable).map((a) => [a.id, a.agent]));
  const signsIn = (id: string) => ["claude-code", "codex", "cursor", "gh"].includes(id);

  return (
    <section className="mt-8" aria-label="Setup">
      <h2 className="mb-2 text-xs text-muted-foreground">
        {noAgent ? "Set up an agent to start" : "Setup"}
      </h2>
      <ul className="divide-y rounded-lg border">
        {problems.map((c) => (
          <li key={c.id} className="px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{c.label}</span>
              <span className="text-xs text-state-needs-input">{STATE_TEXT[c.state]}</span>
            </div>
            {c.detail && <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>}
            {c.fix && <FixCommand text={c.fix} />}
            <div className="flex gap-2">
              {c.state === "signed_out" && signsIn(c.id) && (
                <Button size="xs" className="mt-2" onClick={() => void openSignIn(c.id)} title={`Opens Terminal and runs ${c.fix ?? "the sign-in"}`}>
                  <SquareTerminal />
                  Sign in
                </Button>
              )}
              {installable.get(c.id) && <InstallButton agent={installable.get(c.id) as AgentKind} command={c.fix ?? ""} />}
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void recheckSetup()}
        className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Check again
      </button>
    </section>
  );
}

/** The fix as text, with a copy button for running it by hand. */
function FixCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const command = /^[a-z][\w./-]* /i.test(text);
  return (
    <div className="mt-1.5 flex items-start gap-2">
      <code className="min-w-0 flex-1 font-mono text-xs break-all">{text}</code>
      {command && (
        <button
          type="button"
          aria-label={copied ? "Copied" : `Copy ${text}`}
          title={copied ? "Copied" : "Copy"}
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

/** Installs the maker's own package. Nothing runs until someone clicks. */
function InstallButton({ agent, command }: { agent: AgentKind; command: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      className="mt-2"
      disabled={busy}
      title={`Runs ${command}`}
      onClick={() => {
        setBusy(true);
        void installAgent(agent).finally(() => setBusy(false));
      }}
    >
      {busy ? "Installing…" : "Install"}
    </Button>
  );
}

function List({ title, tasks, onOpen }: { title: string; tasks: Task[]; onOpen: (id: string) => void }) {
  if (tasks.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs text-muted-foreground">{title}</h2>
      <ul className="divide-y rounded-lg border">
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onOpen(t.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60"
            >
              <span className="text-sm font-medium">{t.title}</span>
              <span className="flex min-w-0 items-center gap-2">
                <StateLabel state={t.state} />
                {(t.question ?? t.error?.message) && (
                  <span className="truncate text-xs text-muted-foreground">{t.question ?? t.error?.message}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
