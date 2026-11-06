"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, House, Pin, PinOff, Plus, Search, X } from "lucide-react";
import { STATE_LABELS, isAttention, type Task, type TaskState } from "@solus/core";
import { sidebarSections } from "@/lib/groups";
import { ago } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { displayTitle, useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The left edge bar carries the state; only attention states are loud. */
const BAR: Record<TaskState, string> = {
  idle: "",
  working: "bg-state-working animate-pulse",
  needs_input: "bg-state-needs-input",
  stuck: "bg-state-stuck",
  ready_for_review: "bg-state-review",
  merged: "",
};

export const SEARCH_ID = "sidebar-search";

export function Sidebar() {
  const tasks = useSolus((s) => s.tasks);
  const repo = useSolus((s) => s.repo);
  const status = useSolus((s) => s.status);
  const pinned = useSolus((s) => s.pinned);
  const query = useSolus((s) => s.query);
  const showMerged = useSolus((s) => s.showMerged);
  const activeId = useSolus((s) => s.activeId);
  const toggleMerged = useSolus((s) => s.toggleMerged);
  const { pinned: pinnedTasks, workspaces, merged } = sidebarSections(Object.values(tasks), pinned, query ?? "");
  const empty = Object.keys(tasks).length === 0;

  return (
    <nav aria-label="Workspaces" className="flex min-h-0 flex-1 flex-col">
      <TopNav />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-4">
        {status === "connecting" && <p className="px-3 py-2 text-sm text-muted-foreground">Connecting…</p>}
        {status === "ready" && empty && (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No workspaces yet. Press <kbd className="font-sans font-medium text-foreground">N</kbd> to create one.
          </p>
        )}
        {query && pinnedTasks.length + workspaces.length + merged.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nothing matches “{query}”.</p>
        )}

        {pinnedTasks.length > 0 && (
          <Section label="Pinned">
            {pinnedTasks.map((t) => (
              <WorkspaceRow key={t.id} task={t} />
            ))}
          </Section>
        )}

        {(workspaces.length > 0 || merged.length > 0) && (
          <Section label="My workspaces" hint={repo?.name}>
            {workspaces.map((t) => (
              <WorkspaceRow key={t.id} task={t} />
            ))}
            {/* The open task stays listed when it merges, even with merged tasks collapsed. */}
            {merged
              .filter((t) => showMerged || query || t.id === activeId)
              .map((t) => (
                <WorkspaceRow key={t.id} task={t} />
              ))}
          </Section>
        )}

        {merged.length > 0 && !query && (
          <button
            type="button"
            onClick={toggleMerged}
            className="mt-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {showMerged ? "Show less" : "View all"}
            {!showMerged && (
              <>
                <span className="tabular-nums">· {merged.length} merged</span>
                <ArrowRight className="size-3.5" />
              </>
            )}
          </button>
        )}
      </div>
    </nav>
  );
}

function TopNav() {
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);
  const query = useSolus((s) => s.query);
  const setQuery = useSolus((s) => s.setQuery);
  const goHome = () => useSolus.setState({ activeId: null, showList: false });
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query !== null;

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  return (
    <div className="border-b px-2 pt-3 pb-2">
      <div className="flex items-center gap-2 px-3 pb-2">
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-md bg-foreground text-[0.6875rem] font-bold text-background"
        >
          S
        </span>
        <span className="text-[0.9375rem] font-semibold tracking-tight">Solus</span>
      </div>

      <NavItem icon={<House />} label="Home" onClick={goHome} />
      <NavItem icon={<Plus />} label="Create" shortcut="N" onClick={() => setNewTaskOpen(true)} />
      {query === null ? (
        <NavItem icon={<Search />} label="Search" shortcut="/" onClick={() => setQuery("")} />
      ) : (
        <div className="flex h-9 items-center gap-2.5 rounded-md bg-accent px-3 text-sm">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            id={SEARCH_ID}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery(null);
            }}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={() => setQuery(null)} aria-label="Close search" className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function NavItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-foreground/90 hover:bg-accent hover:text-foreground [&>svg]:size-4 [&>svg]:text-muted-foreground"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <kbd className="font-sans text-xs text-muted-foreground opacity-0 group-hover:opacity-100">{shortcut}</kbd>
      )}
    </button>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="flex items-baseline gap-2 px-3 pb-1.5 text-xs text-muted-foreground">
        {label}
        {hint && <span className="truncate opacity-60">{hint}</span>}
      </h2>
      <ul className="space-y-px">{children}</ul>
    </section>
  );
}

function WorkspaceRow({ task }: { task: Task }) {
  const active = useSolus((s) => s.activeId === task.id);
  const pinned = useSolus((s) => s.pinned.includes(task.id));
  const unread = useSolus((s) => !active && task.lastActivityAt > (s.lastSeen[task.id] ?? Infinity));
  const open = useSolus((s) => s.open);
  const togglePin = useSolus((s) => s.togglePin);
  const now = useNow();
  const attention = isAttention(task.state);
  const hint = task.question ?? task.error?.message;
  const title = useSolus((s) => displayTitle(s, task));

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => open(task.id)}
        aria-current={active ? "true" : undefined}
        title={hint ? `${STATE_LABELS[task.state]}: ${hint}` : `${title} · ${STATE_LABELS[task.state]}`}
        className={cn(
          "relative flex h-9 w-full items-center gap-3 rounded-md pr-3 pl-3 text-left text-sm",
          "hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          task.state === "needs_input" && "bg-state-needs-input-soft",
          task.state === "stuck" && "bg-state-stuck-soft",
          task.state === "merged" ? "text-muted-foreground" : unread || attention ? "text-foreground" : "text-foreground/75",
          (unread || attention) && "font-semibold",
          // Selected: the clearest row in the list.
          active && "bg-foreground/10 font-medium text-foreground ring-1 ring-foreground/15 hover:bg-foreground/10",
        )}
      >
        {BAR[task.state] && (
          <span
            aria-hidden
            className={cn("absolute top-2 bottom-2 left-0 w-[3px] rounded-full", BAR[task.state])}
          />
        )}
        <span className="sr-only">{STATE_LABELS[task.state]}:</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums group-hover:invisible">
          {now !== null ? ago(now - task.lastActivityAt) : ""}
        </span>
      </button>
      <button
        type="button"
        onClick={() => togglePin(task.id)}
        aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
        className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground group-hover:block hover:bg-accent hover:text-foreground focus-visible:block"
      >
        {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
    </li>
  );
}
