"use client";

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import type { AgentKind, TaskSource, TaskSources } from "@solus/core";
import { AgentPicker } from "@/components/agent-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { createAndStart, listSources } from "@/lib/actions";
import { useSolus } from "@/lib/store";

type SourceKind = "prompt" | "branch" | "pr" | "issue";

const KINDS: readonly (readonly [SourceKind, string])[] = [
  ["prompt", "New"],
  ["branch", "Branch"],
  ["pr", "Pull request"],
  ["issue", "Issue"],
];

function toSource(kind: SourceKind, pick: string): TaskSource | undefined {
  if (kind === "prompt" || !pick) return undefined;
  return kind === "branch" ? { type: "branch", branch: pick } : { type: kind, number: Number(pick) };
}

export function NewTaskDialog() {
  const open = useSolus((s) => s.newTaskOpen);
  const repo = useSolus((s) => s.repo);
  const setOpen = useSolus((s) => s.setNewTaskOpen);
  const [prompt, setPrompt] = useState("");
  // Kept between tasks, so the last agent you picked stays the default.
  const [chosen, setAgent] = useState<AgentKind | null>(null);
  const checks = useSolus((s) => s.setup?.agents);
  const usable = (checks ?? []).filter((a) => a.state === "ready").map((a) => a.agent);
  const agent = chosen && usable.includes(chosen) ? chosen : (usable[0] ?? null);

  const connected = useSolus((s) => s.connected);

  const [kind, setKind] = useState<SourceKind>("prompt");
  const [pick, setPick] = useState("");
  const [sources, setSources] = useState<TaskSources | null>(null);

  useEffect(() => {
    if (open) void listSources().then((s) => setSources(s ?? null));
  }, [open]);

  const source = toSource(kind, pick);
  const ready = connected && agent && (kind === "prompt" ? prompt.trim() : source);

  const submit = () => {
    if (!ready || !agent) return;
    void createAndStart(prompt, agent, source);
    setPrompt("");
    setPick("");
    setKind("prompt");
    setOpen(false);
  };

  const options =
    kind === "branch"
      ? (sources?.branches ?? []).map((b) => ({ value: b, label: b }))
      : ((kind === "pr" ? sources?.pullRequests : sources?.issues) ?? []).map((i) => ({
          value: String(i.number),
          label: `#${i.number} ${i.title}`,
        }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            New worktree on {repo?.name}{kind === "branch" || kind === "pr" ? "" : ", branched from"}
            <span className="inline-flex items-center gap-1 font-mono text-xs" hidden={kind === "branch" || kind === "pr"}>
              <GitBranch className="size-3" />
              {repo?.defaultBranch}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Start from" className="flex gap-1 text-xs">
          {KINDS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setPick("");
              }}
              className={`rounded-md px-2.5 py-1 ${kind === k ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {kind !== "prompt" &&
          (options.length > 0 ? (
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="Choose what to start from"
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">
              {sources ? "Nothing to choose here." : "Loading…"}
              {kind !== "branch" && sources && " This needs a GitHub remote and the GitHub CLI."}
            </p>
          ))}
        <Textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={kind === "prompt" ? "What should the agent do? The first line becomes the title." : "Anything to add? (optional)"}
          rows={5}
          className="resize-none"
        />
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {agent ? (
            <AgentPicker value={agent} onChange={setAgent} />
          ) : (
            <span className="text-xs text-muted-foreground">No agent is ready. See Home.</span>
          )}
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Enter to start</span>
          <Button onClick={submit} disabled={!ready}>
            Start task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
