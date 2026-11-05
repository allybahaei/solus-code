"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
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
import { BASE_BRANCH, REPO } from "@/lib/runner";
import { useSolus } from "@/lib/store";

export function NewTaskDialog() {
  const open = useSolus((s) => s.newTaskOpen);
  const setOpen = useSolus((s) => s.setNewTaskOpen);
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    if (!prompt.trim()) return;
    void createAndStart(prompt);
    setPrompt("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            New worktree on {REPO}, branched from
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              {BASE_BRANCH}
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
        <DialogFooter className="items-center sm:justify-between">
          <span className="hidden text-xs text-muted-foreground sm:inline">Enter to start · Shift+Enter for a new line</span>
          <Button onClick={submit} disabled={!prompt.trim()}>
            Start task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
