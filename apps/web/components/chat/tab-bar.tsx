"use client";

import { useState } from "react";
import { AudioLines, ChevronLeft, History, Link2, PanelRight, Pencil, Plus, X } from "lucide-react";
import type { AgentKind, Task } from "@solus/core";
import { AGENTS, AgentIcon } from "@/components/agent-picker";
import { StateDot } from "@/components/state-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REPO } from "@/lib/runner";
import { displayTitle, useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-[18px]";

/** Repo title, workspace tabs, and workspace actions. */
export function TabBar() {
  const openTabs = useSolus((s) => s.openTabs);
  const tasks = useSolus((s) => s.tasks);
  const setShowList = useSolus((s) => s.setShowList);
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);
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

      <div className="flex shrink-0 items-center gap-2 pr-3 pl-2 md:pl-4">
        <AudioLines
          aria-label={anyWorking ? "Agents working" : "No agents working"}
          className={cn("size-4", anyWorking ? "animate-pulse text-state-review" : "text-muted-foreground")}
        />
        <span className="max-w-48 truncate text-[15px] font-semibold tracking-tight">{REPO}</span>
      </div>

      <div
        role="tablist"
        aria-label="Open workspaces"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {openTabs.map((id) => {
          const task = tasks[id];
          return task ? <Tab key={id} task={task} /> : null;
        })}
        <button
          type="button"
          className={cn(iconButton, "my-auto ml-1")}
          onClick={() => setNewTaskOpen(true)}
          aria-label="New task"
          title="New task (N)"
        >
          <Plus />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <HistoryMenu />
        <CopyLinkButton />
        <AgentStack />
        <PaneToggle />
      </div>
    </div>
  );
}

function Tab({ task }: { task: Task }) {
  const active = useSolus((s) => s.activeId === task.id);
  const title = useSolus((s) => displayTitle(s, task));
  const open = useSolus((s) => s.open);
  const closeTab = useSolus((s) => s.closeTab);
  const rename = useSolus((s) => s.rename);
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "group relative flex max-w-56 min-w-28 shrink items-center gap-1.5 px-3 text-sm",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onAuxClick={(e) => e.button === 1 && closeTab(task.id)}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={title}
          aria-label="Workspace name"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            rename(task.id, e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-40 rounded bg-accent px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => open(task.id)}
          onDoubleClick={() => setEditing(true)}
          className="flex min-w-0 items-center gap-2 py-3 outline-none focus-visible:underline"
          title={`${title} · double-click to rename, middle-click to close`}
        >
          {task.state !== "idle" && task.state !== "ready_for_review" && task.state !== "merged" && (
            <StateDot state={task.state} />
          )}
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
      {!editing && (
        <button
          type="button"
          onClick={() => closeTab(task.id)}
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

function HistoryMenu() {
  const closedTabs = useSolus((s) => s.closedTabs);
  const tasks = useSolus((s) => s.tasks);
  const renames = useSolus((s) => s.renames);
  const open = useSolus((s) => s.open);
  const closed = closedTabs.map((id) => tasks[id]).filter((t): t is Task => !!t);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={iconButton} aria-label="Recently closed tabs" title="Recently closed">
        <History />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Recently closed</DropdownMenuLabel>
        {closed.length === 0 ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">Nothing closed yet.</p>
        ) : (
          closed.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => open(t.id)} className="gap-2">
              <StateDot state={t.state} />
              <span className="truncate">{displayTitle({ renames }, t)}</span>
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
      title={`Copy ${what}`}
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

/** The agents running in open workspaces, overlapped like avatars. */
function AgentStack() {
  const tasks = useSolus((s) => s.tasks);
  const openTabs = useSolus((s) => s.openTabs);
  const agents = [
    ...new Set(openTabs.map((id) => tasks[id]?.agent).filter((a): a is AgentKind => !!a)),
  ];
  if (agents.length === 0) return null;
  return (
    <div
      className="mx-1.5 flex items-center -space-x-1.5"
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
