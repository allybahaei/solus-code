"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, AudioLines, ChevronLeft, History, Link2, PanelRight, Pencil, Plus, X } from "lucide-react";
import { chatsOf, type Chat, type Task } from "@solus/core";
import { AGENTS, AgentIcon } from "@/components/agent-picker";
import { DeleteTask } from "@/components/chat/task-bar";
import { StateDot } from "@/components/state-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { archiveTask, newChat } from "@/lib/actions";
import { activeChatId, chatTitle, displayTitle, useSolus, visibleChats } from "@/lib/store";
import { cn } from "@/lib/utils";

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-[18px]";

/** The workspace's name, its chat tabs, and workspace actions. */
export function TabBar() {
  const task = useSolus((s) => (s.activeId ? s.tasks[s.activeId] : undefined));
  const tasks = useSolus((s) => s.tasks);
  const repo = useSolus((s) => s.repo);
  const setShowList = useSolus((s) => s.setShowList);
  const anyWorking = Object.values(tasks).some((t) => t.state === "working");

  return (
    <div className="flex h-12 shrink-0 items-stretch gap-1 border-b bg-card pr-2">
      <button
        type="button"
        className={cn(iconButton, "my-auto ml-1 md:hidden")}
        onClick={() => setShowList(true)}
        aria-label="Back to workspaces"
      >
        <ChevronLeft />
      </button>

      {/* The name gives way to the tabs on phones. */}
      <div className="hidden max-w-[35%] min-w-0 shrink-0 items-center gap-2 pr-3 pl-2 md:flex md:pl-4">
        <AudioLines
          aria-label={anyWorking ? "Agents working" : "No agents working"}
          className={cn("size-4 shrink-0", anyWorking ? "animate-pulse text-state-review" : "text-muted-foreground")}
        />
        {task ? <WorkspaceName task={task} /> : <span className="max-w-48 truncate text-[0.9375rem] font-semibold tracking-tight">{repo?.name}</span>}
      </div>

      {task ? <ChatTabs task={task} /> : <div className="flex-1" />}

      <div className="flex shrink-0 items-center gap-0.5">
        {task && <HistoryMenu task={task} />}
        <CopyLinkButton />
        {task && <ArchiveButton task={task} />}
        {task && <DeleteTask key={task.id} task={task} className={iconButton} />}
        {task && <AgentStack task={task} />}
        <PaneToggle />
      </div>
    </div>
  );
}

function ArchiveButton({ task }: { task: Task }) {
  if (task.archivedAt) return null;
  return (
    <button
      type="button"
      className={iconButton}
      onClick={() => void archiveTask(task.id)}
      aria-label="Archive task"
      title="Archive: commits its work, frees the worktree, keeps the branch and chat"
    >
      <Archive />
    </button>
  );
}

function WorkspaceName({ task }: { task: Task }) {
  const title = useSolus((s) => displayTitle(s, task));
  const rename = useSolus((s) => s.rename);
  const [editing, setEditing] = useState(false);
  return editing ? (
    <NameInput label="Workspace name" value={title} onDone={(v) => (rename(task.id, v), setEditing(false))} onCancel={() => setEditing(false)} />
  ) : (
    <button
      type="button"
      onDoubleClick={() => setEditing(true)}
      title={`${title} · double-click to rename`}
      className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight outline-none focus-visible:underline"
    >
      {title}
    </button>
  );
}

function NameInput({ label, value, onDone, onCancel }: { label: string; value: string; onDone: (v: string) => void; onCancel: () => void }) {
  return (
    <input
      autoFocus
      defaultValue={value}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onCancel();
      }}
      className="w-40 rounded bg-accent px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

/** A tab per conversation. They all work in this task's one worktree. */
function ChatTabs({ task }: { task: Task }) {
  const closed = useSolus((s) => s.closedChats[task.id]);
  const activeId = useSolus((s) => activeChatId(s, task));
  const chats = visibleChats({ closedChats: closed ? { [task.id]: closed } : {} }, task);
  const canAdd = task.state !== "idle" && task.state !== "merged" && !task.archivedAt;
  const agent = chatsOf(task).find((c) => c.id === activeId)?.agent ?? task.agent;

  return (
    <div
      role="tablist"
      aria-label="Chats in this workspace"
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chats.map((c) => (
        <ChatTab key={c.id} task={task} chat={c} active={c.id === activeId} closable={chats.length > 1} />
      ))}
      {canAdd && (
        <button
          type="button"
          className={cn(iconButton, "my-auto ml-1")}
          onClick={() => void newChat(task.id, agent)}
          aria-label="New chat"
          title="New chat in this workspace"
        >
          <Plus />
        </button>
      )}
    </div>
  );
}

function ChatTab({ task, chat, active, closable }: { task: Task; chat: Chat; active: boolean; closable: boolean }) {
  const title = useSolus((s) => chatTitle(s, task, chat));
  const openChat = useSolus((s) => s.openChat);
  const closeChat = useSolus((s) => s.closeChat);
  const rename = useSolus((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const key = `${task.id}/${chat.id}`;
  const ref = useRef<HTMLDivElement>(null);

  // Keep the open tab in view when there are more than fit.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      className={cn(
        "group relative flex max-w-56 min-w-24 shrink-0 items-center gap-1.5 px-3 text-sm",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onAuxClick={(e) => e.button === 1 && closeChat(task.id, chat.id)}
    >
      {editing ? (
        <NameInput label="Chat name" value={title} onDone={(v) => (rename(key, v), setEditing(false))} onCancel={() => setEditing(false)} />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => openChat(task.id, chat.id)}
          onDoubleClick={() => setEditing(true)}
          className="flex min-w-0 items-center gap-2 py-3 outline-none focus-visible:underline"
          title={`${title} · double-click to rename, middle-click to close`}
        >
          {chat.state !== "idle" && chat.state !== "ready_for_review" && <StateDot state={chat.state} />}
          <span className="truncate">{title}</span>
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Rename ${title}`}
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:text-foreground",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      {!editing && closable && (
        <button
          type="button"
          onClick={() => closeChat(task.id, chat.id)}
          aria-label={`Close ${title}`}
          title="Close (X)"
          className="-mr-1 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" />}
    </div>
  );
}

/** Closed chat tabs in this workspace. Closing a tab keeps the conversation. */
function HistoryMenu({ task }: { task: Task }) {
  const closedIds = useSolus((s) => s.closedChats[task.id]);
  const renames = useSolus((s) => s.renames);
  const openChat = useSolus((s) => s.openChat);
  const closed = (closedIds ?? []).flatMap((id) => chatsOf(task).filter((c) => c.id === id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(iconButton, "hidden md:grid")} aria-label="Closed chats" title="Closed chats">
        <History />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Closed chats</DropdownMenuLabel>
        {closed.length === 0 ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">Nothing closed yet.</p>
        ) : (
          closed.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => openChat(task.id, c.id)} className="gap-2">
              <StateDot state={c.state} />
              <span className="truncate">{chatTitle({ renames }, task, c)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CopyLinkButton() {
  const task = useSolus((s) => (s.activeId ? s.tasks[s.activeId] : undefined));
  const setNotice = useSolus((s) => s.setNotice);
  if (!task) return null;
  const value = task.pullRequest?.url ?? task.branch;
  const what = task.pullRequest ? "pull request link" : "branch name";

  return (
    <button
      type="button"
      className={iconButton}
      aria-label={`Copy ${what}`}
      title={`Copy ${what}: ${value}`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setNotice(`Copied ${what}: ${value}`),
          () => setNotice(`Couldn't copy the ${what}.`),
        );
      }}
    >
      <Link2 />
    </button>
  );
}

/** The agents in this workspace's chats, overlapped like avatars. */
function AgentStack({ task }: { task: Task }) {
  const agents = [...new Set(chatsOf(task).map((c) => c.agent))];
  return (
    <div
      className="mx-1.5 hidden items-center -space-x-1.5 md:flex"
      aria-label={`Agents: ${agents.map((a) => AGENTS[a].label).join(", ")}`}
      title={agents.map((a) => AGENTS[a].label).join(", ")}
    >
      {agents.map((a) => (
        <span key={a} className="grid size-6 place-items-center rounded-full bg-secondary ring-2 ring-background">
          <AgentIcon agent={a} className="size-3.5" />
        </span>
      ))}
    </div>
  );
}

function PaneToggle() {
  const open = useSolus((s) => s.rightPaneOpen);
  const toggle = useSolus((s) => s.toggleRightPane);
  return (
    <button
      type="button"
      className={cn(iconButton, "hidden lg:grid", open && "text-foreground")}
      onClick={toggle}
      aria-pressed={open}
      aria-label={open ? "Hide changes and terminal" : "Show changes and terminal"}
      title={open ? "Hide changes and terminal" : "Show changes and terminal"}
    >
      <PanelRight />
    </button>
  );
}
