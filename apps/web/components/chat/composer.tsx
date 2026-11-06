"use client";

import { useRef, useState } from "react";
import { ArchiveRestore, ArrowUp, CircleAlert, MessageCircleQuestion, Paperclip, Play, ShieldQuestion, X } from "lucide-react";
import type { AgentKind, Task } from "@solus/core";
import { AgentPicker } from "@/components/agent-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerApproval, attachFile, restoreTask, sendMessage, startTask } from "@/lib/actions";
import { useSolus } from "@/lib/store";
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

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Attention banner (question or error) plus the reply box. */
export function Composer({ task }: { task: Task }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[task.id] ?? "";
  const setText = (v: string) => setDrafts((d) => ({ ...d, [task.id]: v }));
  const disabled = task.state === "merged";
  // Sending while offline would fail after the box has cleared, losing the text.
  const connected = useSolus((s) => s.connected);
  // The agent for the next message. Composer is keyed by task, so this resets per task.
  const [agent, setAgent] = useState<AgentKind>(task.agent);

  const approvalId = task.approval?.id ?? "";

  const [attached, setAttached] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const canAttach = !disabled && connected;

  const attach = async (files: Iterable<File>) => {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        useSolus.getState().setNotice(`${file.name} is over the 20 MB limit.`);
        continue;
      }
      const path = await attachFile(task.id, file);
      if (path) setAttached((a) => [...a, path]);
    }
  };

  const send = () => {
    const typed = text.trim();
    if ((!typed && attached.length === 0) || disabled || !connected) return;
    const note = attached.length > 0 ? `Attached files, in this worktree:\n${attached.map((p) => `- ${p}`).join("\n")}` : "";
    setText("");
    setAttached([]);
    void sendMessage(task.id, [typed, note].filter(Boolean).join("\n\n"), agent);
  };

  if (task.archivedAt) {
    return (
      <div className="shrink-0 px-4 pb-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">This task is archived. Its branch and chat are kept.</span>
          <Button size="sm" onClick={() => restoreTask(task.id)}>
            <ArchiveRestore />
            Restore
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="w-full">
        {task.approval ? (
          <Banner tone="needs_input" icon={<ShieldQuestion />} title={`Allow ${task.approval.tool}?`}>
            <code className="block font-mono text-xs break-all whitespace-pre-wrap">{task.approval.summary}</code>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={!connected} onClick={() => answerApproval(task.id, approvalId, true)}>
                Allow
              </Button>
              <Button size="sm" variant="outline" disabled={!connected} onClick={() => answerApproval(task.id, approvalId, false)}>
                Deny
              </Button>
            </div>
          </Banner>
        ) : (
          task.state === "needs_input" &&
          task.question && (
            <Banner tone="needs_input" icon={<MessageCircleQuestion />} title="The agent is asking">
              {task.question}
            </Banner>
          )
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
              onPaste={(e) => {
                if (e.clipboardData.files.length > 0 && canAttach) {
                  e.preventDefault();
                  void attach(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") e.currentTarget.blur();
              }}
              placeholder={task.approval ? "Or say what to do instead…" : PLACEHOLDER[task.state]}
              rows={4}
              className="max-h-80 min-h-28 resize-none border-0 bg-transparent px-3.5 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {attached.length > 0 && (
              <ul className="flex flex-wrap gap-1 px-3 pb-2">
                {attached.map((p) => (
                  <li key={p} className="flex items-center gap-1 rounded bg-muted py-0.5 pr-1 pl-2 font-mono text-xs">
                    {p.split("/").at(-1)?.replace(/^\d+-/, "")}
                    <button
                      type="button"
                      onClick={() => setAttached((a) => a.filter((x) => x !== p))}
                      aria-label={`Remove ${p}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between px-2.5 pb-2.5">
              <span className="flex items-center gap-1">
                <AgentPicker value={agent} onChange={setAgent} disabled={disabled} />
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void attach(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canAttach}
                  onClick={() => fileInput.current?.click()}
                  aria-label="Attach files"
                  title="Attach files, or paste a screenshot"
                >
                  <Paperclip />
                </Button>
              </span>
              <Button size="icon-sm" onClick={send} disabled={disabled || !connected || (!text.trim() && attached.length === 0)} aria-label="Send">
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
