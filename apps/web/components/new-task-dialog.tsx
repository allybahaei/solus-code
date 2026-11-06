"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { AgentKind } from "@solus/core";
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
import { createAndStart } from "@/lib/actions";
import { useSolus } from "@/lib/store";

export function NewTaskDialog() {
  const open = useSolus((s) => s.newTaskOpen);
  const repo = useSolus((s) => s.repo);
  const setOpen = useSolus((s) => s.setNewTaskOpen);
  const [prompt, setPrompt] = useState("");
  // Kept between tasks, so the last agent you picked stays the default.
  const [agent, setAgent] = useState<AgentKind>("claude-code");

  const connected = useSolus((s) => s.connected);

  const submit = () => {
    if (!prompt.trim() || !connected) return;
    void createAndStart(prompt, agent);
    setPrompt("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            New worktree on {repo?.name}, branched from
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              {repo?.defaultBranch}
            </span>
          </DialogDescription>
        </DialogHeader>
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
          placeholder="What should the agent do? The first line becomes the title."
          rows={5}
          className="resize-none"
        />
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <AgentPicker value={agent} onChange={setAgent} />
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Enter to start</span>
          <Button onClick={submit} disabled={!prompt.trim() || !connected}>
            Start task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
