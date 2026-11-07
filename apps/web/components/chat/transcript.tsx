"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AgentMessage, Task } from "@solus/core";
import { Markdown } from "@/components/markdown";
import { useTypedText } from "@/lib/typewriter";
import { cn } from "@/lib/utils";

type Item = { kind: "message"; message: AgentMessage } | { kind: "tools"; id: string; calls: AgentMessage[] };

/** Runs of consecutive tool calls collapse into one row. */
function toItems(messages: AgentMessage[]): Item[] {
  const items: Item[] = [];
  for (const m of messages) {
    const last = items.at(-1);
    if (m.role === "tool") {
      if (last?.kind === "tools") last.calls.push(m);
      else items.push({ kind: "tools", id: m.id, calls: [m] });
    } else {
      items.push({ kind: "message", message: m });
    }
  }
  return items;
}

export function Transcript({ task, messages, newChat = false }: { task: Task; messages: AgentMessage[]; newChat?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Messages already here when the chat opens are history, so they don't replay.
  const [history] = useState(() => new Set(messages.map((m) => m.id)));
  const items = toItems(messages);
  const lastText = messages.at(-1)?.text.length ?? 0;

  // Follow new output while the user is at the bottom; stop if they scroll up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastText, task.state]);

  useEffect(() => {
    pinned.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [task.id]);

  const followTyping = () => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      <div className="w-full space-y-5 px-4 py-6 text-sm leading-relaxed">
        {items.length === 0 && (
          <p className="text-muted-foreground">
            {newChat
              ? "A new chat in this workspace. It shares the same files and branch as the other chats."
              : task.state === "idle"
                ? "Not started yet. The agent will begin with this prompt:"
                : "No output yet."}
          </p>
        )}
        {items.length === 0 && task.state === "idle" && !newChat && (
          <div className="rounded-lg border bg-muted/40 px-3 py-2 whitespace-pre-wrap">{task.prompt}</div>
        )}
        {items.map((item, i) =>
          item.kind === "tools" ? (
            <ToolGroup key={item.id} calls={item.calls} live={task.state === "working" && i === items.length - 1} />
          ) : item.message.role === "user" ? (
            <div key={item.message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-user-bubble px-5 py-3.5 whitespace-pre-wrap">
                {item.message.text}
              </div>
            </div>
          ) : (
            <AgentText
              key={item.message.id}
              text={item.message.text}
              fromStart={!history.has(item.message.id)}
              onType={followTyping}
            />
          ),
        )}
        {task.state === "working" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-state-working" />
            Working
          </div>
        )}
      </div>
    </div>
  );
}

function AgentText({ text, fromStart, onType }: { text: string; fromStart: boolean; onType: () => void }) {
  return <Markdown text={useTypedText(text, fromStart, onType)} />;
}

function ToolGroup({ calls, live }: { calls: AgentMessage[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const show = expanded || live;
  const last = calls.at(-1);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={show}
        className="flex max-w-full min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", show && "rotate-90")} />
        <span className="shrink-0 whitespace-nowrap">
          {calls.length} tool {calls.length === 1 ? "call" : "calls"}
        </span>
        {!show && last && (
          <span className="ml-1 min-w-0 truncate font-mono opacity-70">
            · {last.tool} {last.text}
          </span>
        )}
      </button>
      {show && (
        <ul className="mt-1.5 space-y-1 border-l pl-3 font-mono text-muted-foreground">
          {calls.map((c) => (
            <li key={c.id} className="truncate">
              <span className="text-foreground/80">{c.tool}</span> {c.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
