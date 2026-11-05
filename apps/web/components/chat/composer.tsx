"use client";

import { useState } from "react";
import { ArrowUp, CircleAlert, MessageCircleQuestion, Play } from "lucide-react";
import type { AgentKind, Task } from "@solus/core";
import { AgentPicker } from "@/components/agent-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendMessage, startTask } from "@/lib/actions";
import { cn } from "@/lib/utils";

const PLACEHOLDER: Record<Task["state"], string> = {
  idle: "",
  working: "Add guidance while the agent works…",
  needs_input: "Answer the agent…",
  stuck: "Nudge the agent: what should it try?",
  ready_for_review: "Request changes…",
  merged: "This workspace is merged.",
};

export const COMPOSER_ID = "composer";

/** Attention banner (question or error) plus the reply box. */
export function Composer({ task }: { task: Task }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[task.id] ?? "";
  const setText = (v: string) => setDrafts((d) => ({ ...d, [task.id]: v }));
  const disabled = task.state === "merged";
  // The agent for the next message. Composer is keyed by task, so this resets per task.
  const [agent, setAgent] = useState<AgentKind>(task.agent);

  const send = () => {
    const message = text.trim();
    if (!message || disabled) return;
    setText("");
    void sendMessage(task.id, message, agent);
  };

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="w-full">
        {task.state === "needs_input" && task.question && (
          <Banner tone="needs_input" icon={<MessageCircleQuestion />} title="The agent is asking">
            {task.question}
          </Banner>
        )}
        {task.state === "stuck" && task.error && (
          <Banner tone="stuck" icon={<CircleAlert />} title={task.error.message}>
            {task.error.detail}
          </Banner>
        )}

        {task.state === "idle" ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="text-sm text-muted-foreground">The agent hasn&apos;t started.</span>
            <Button size="sm" onClick={() => startTask(task.id)}>
              <Play />
              Start
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring/40",
              task.state === "needs_input" && "border-state-needs-input/60",
              task.state === "stuck" && "border-state-stuck/50",
            )}
          >
            <Textarea
              id={COMPOSER_ID}
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") e.currentTarget.blur();
              }}
              placeholder={PLACEHOLDER[task.state]}
              rows={4}
              className="max-h-80 min-h-28 resize-none border-0 bg-transparent px-3.5 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between px-2.5 pb-2.5">
              <AgentPicker value={agent} onChange={setAgent} disabled={disabled} />
              <Button size="icon-sm" onClick={send} disabled={disabled || !text.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "needs_input" | "stuck";
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "needs_input"
          ? "border-state-needs-input/40 bg-state-needs-input-soft [&>svg]:text-state-needs-input"
          : "border-state-stuck/40 bg-state-stuck-soft [&>svg]:text-state-stuck",
      )}
    >
      {icon}
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}
