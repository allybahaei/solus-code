"use client";

import { useRef, useState } from "react";
import { ArchiveRestore, ArrowUp, CircleAlert, ClipboardList, Clock, MessageCircleQuestion, Paperclip, Pencil, Play, ShieldQuestion, X } from "lucide-react";
import { MAIN_CHAT, chatsOf, type AgentKind, type ChatOptions, type QueuedMessage, type Task } from "@solus/core";
import { AgentPicker } from "@/components/agent-picker";
import { ModelPicker } from "@/components/chat/model-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerApproval, archiveTask, attachFile, editQueued, listFiles, newChat, restoreTask, sendMessage, setChatOptions, startTask, stopTask } from "@/lib/actions";
import { insertMention, matchScore, menuTrigger } from "@/lib/composer";
import { useReview } from "@/lib/review-store";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

const PLACEHOLDER: Record<Task["state"], string> = {
  idle: "What should this chat work on?",
  working: "Queue a message for when the agent finishes…",
  needs_input: "Answer the agent…",
  stuck: "Nudge the agent: what should it try?",
  ready_for_review: "Request changes…",
  merged: "This workspace is merged.",
};

export const COMPOSER_ID = "composer";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Attention banner (question or error) plus the reply box. */
export function Composer({ task, chatId }: { task: Task; chatId: string }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[task.id] ?? "";
  const setText = (v: string) => setDrafts((d) => ({ ...d, [task.id]: v }));
  const disabled = task.state === "merged";
  // Sending while offline would fail after the box has cleared, losing the text.
  const connected = useSolus((s) => s.connected);
  // The agent for the next message. Composer is keyed by task, so this resets per task.
  const [agent, setAgent] = useState<AgentKind>(task.agent);

  const approvalId = task.approval?.id ?? "";
  const chat = chatsOf(task).find((c) => c.id === chatId);
  const options: ChatOptions = chat?.options ?? {};
  const setOptions = (next: ChatOptions) => void setChatOptions(task.id, next, chatId);
  const togglePlan = () => {
    const { plan, ...rest } = options;
    setOptions(plan ? rest : { ...rest, plan: true });
  };

  const box = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const trigger = dismissed ? null : menuTrigger(text, caret);

  const commands: MenuItem[] = [
    { id: "plan", label: "/plan", hint: options.plan ? "Turn plan mode off" : "Plan first, change nothing yet", run: togglePlan },
    { id: "new", label: "/new", hint: "New chat in this workspace", run: () => void newChat(task.id, agent) },
    { id: "review", label: "/review", hint: "Review the diff", run: () => useReview.getState().setView(task.id, "review") },
    { id: "stop", label: "/stop", hint: "Stop the agent", run: () => void stopTask(task.id, chatId) },
    { id: "archive", label: "/archive", hint: "Archive this task", run: () => void archiveTask(task.id) },
    { id: "help", label: "/help", hint: "Keyboard shortcuts", run: () => useSolus.getState().setOverlay("shortcuts") },
  ];
  const ranked = <T,>(items: T[], name: (item: T) => string, query: string) =>
    items
      .flatMap((item) => {
        const score = matchScore(query, name(item));
        return score === null ? [] : [{ item, score }];
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map((m) => m.item);
  const menu: MenuItem[] =
    trigger?.kind === "command"
      ? ranked(commands, (c) => c.label.slice(1), trigger.query)
      : trigger?.kind === "file"
        ? ranked(files ?? [], (f) => f, trigger.query).map((path) => ({ id: path, label: path, run: () => mention(trigger.start, path) }))
        : [];
  const current = Math.min(picked, Math.max(0, menu.length - 1));

  const mention = (start: number, path: string) => {
    const next = insertMention(text, caret, start, path);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => box.current?.setSelectionRange(next.caret, next.caret));
  };

  const choose = (item: MenuItem | undefined) => {
    if (!item) return;
    if (trigger?.kind === "command") {
      setText("");
      setCaret(0);
    }
    item.run();
    setPicked(0);
    box.current?.focus();
  };

  const track = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart);
    setPicked(0);
    setDismissed(false);
    // Asked for at the first @, and again each time, since agents add files.
    const before = el.value.slice(0, el.selectionStart);
    if (/(?:^|\s)@[^\s@]*$/.test(before) && (files === null || before.endsWith("@"))) {
      void listFiles(task.id).then((list) => list && setFiles(list));
    }
  };

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
    void sendMessage(task.id, [typed, note].filter(Boolean).join("\n\n"), agent, chatId);
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

        {task.state === "idle" && chatId === MAIN_CHAT ? (
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
            {chat?.queued && chat.queued.length > 0 && <Queue task={task} chatId={chatId} queued={chat.queued} />}
            {menu.length > 0 && (
              <ul role="listbox" aria-label={trigger?.kind === "file" ? "Files" : "Commands"} className="no-scrollbar max-h-64 overflow-y-auto border-b p-1.5">
                {menu.map((item, i) => (
                  <li key={item.id} role="option" aria-selected={i === current}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setPicked(i)}
                      onClick={() => choose(item)}
                      className={cn("flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-sm", i === current && "bg-accent")}
                    >
                      <span className="min-w-0 truncate font-mono text-[0.8125rem]">{item.label}</span>
                      {item.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Textarea
              id={COMPOSER_ID}
              ref={box}
              value={text}
              disabled={disabled}
              onChange={(e) => {
                setText(e.target.value);
                track(e.target);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onPaste={(e) => {
                if (e.clipboardData.files.length > 0 && canAttach) {
                  e.preventDefault();
                  void attach(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (menu.length > 0) {
                  const moves: Record<string, () => void> = {
                    ArrowDown: () => setPicked(Math.min(menu.length - 1, current + 1)),
                    ArrowUp: () => setPicked(Math.max(0, current - 1)),
                    Enter: () => choose(menu[current]),
                    Tab: () => choose(menu[current]),
                    Escape: () => setDismissed(true),
                  };
                  const move = moves[e.key];
                  if (move && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    move();
                    return;
                  }
                }
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
                <ModelPicker agent={agent} options={options} onChange={setOptions} />
                <Button
                  size="sm"
                  variant={options.plan ? "secondary" : "ghost"}
                  disabled={disabled}
                  onClick={togglePlan}
                  aria-pressed={!!options.plan}
                  title="Plan mode: the agent proposes a plan and changes nothing until you turn this off"
                  className="h-7 gap-1 px-2 text-xs font-normal"
                >
                  <ClipboardList className="size-3.5" />
                  Plan
                </Button>
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

interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Messages waiting for the agent. They can be changed or removed until they go. */
function Queue({ task, chatId, queued }: { task: Task; chatId: string; queued: QueuedMessage[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <ul aria-label="Queued messages" className="space-y-1 border-b p-2">
      {queued.map((q) => (
        <li key={q.id} className="flex items-center gap-2 rounded-md bg-muted/50 py-1 pr-1 pl-2 text-sm">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Waiting" />
          {editing === q.id ? (
            <input
              autoFocus
              defaultValue={q.text}
              aria-label="Edit queued message"
              onBlur={(e) => {
                void editQueued(task.id, q.id, e.currentTarget.value, chatId);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
              }}
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{q.text}</span>
          )}
          <button type="button" onClick={() => setEditing(q.id)} aria-label="Edit" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={() => void editQueued(task.id, q.id, "", chatId)} aria-label="Remove" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
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
