"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { STATE_LABELS } from "@solus/core";
import { StateDot } from "@/components/state-dot";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { archiveTask, loadOpenTargets, newChat, openWorkspace, startTask, stopTask } from "@/lib/actions";
import { matchScore } from "@/lib/composer";
import { useReview } from "@/lib/review-store";
import { displayTitle, useSolus } from "@/lib/store";
import { SHORTCUTS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

function useCommands(): Command[] {
  const tasks = useSolus((s) => s.tasks);
  const activeId = useSolus((s) => s.activeId);
  const renames = useSolus((s) => s.renames);
  const targets = useSolus((s) => s.openTargets);
  const task = activeId ? tasks[activeId] : undefined;

  return useMemo(() => {
    const s = useSolus.getState();
    const r = useReview.getState();
    const list: Command[] = [{ id: "new", label: "New task", hint: "N", run: () => s.setNewTaskOpen(true) }];
    if (task) {
      if (task.state === "idle") list.push({ id: "start", label: "Start the agent", hint: "S", run: () => void startTask(task.id) });
      if (task.state === "working") list.push({ id: "stop", label: "Stop the agent", run: () => void stopTask(task.id) });
      list.push({ id: "review", label: "Review the diff", hint: "R", run: () => r.setView(task.id, "review") });
      if (task.state === "ready_for_review") {
        if (!task.pullRequest) {
          list.push({ id: "merge", label: "Merge", hint: "M", run: () => r.openMerge(task.id, "merge") });
          list.push({ id: "pr", label: "Open a pull request", hint: "P", run: () => r.openMerge(task.id, "pr") });
        } else {
          list.push({ id: "checks", label: "Show checks", hint: "M", run: () => r.setView(task.id, "checks") });
        }
      }
      if (task.state !== "idle" && task.state !== "merged") list.push({ id: "chat", label: "New chat in this workspace", run: () => void newChat(task.id, task.agent) });
      for (const t of targets ?? []) list.push({ id: `open-${t.id}`, label: `Open in ${t.label}`, run: () => void openWorkspace(task.id, t.id) });
      if (!task.archivedAt) list.push({ id: "archive", label: "Archive this task", run: () => void archiveTask(task.id) });
    }
    list.push(
      { id: "home", label: "Go home", run: () => useSolus.setState({ activeId: null, showList: false }) },
      { id: "sidebar", label: "Show or hide the sidebar", hint: "⌘B", run: s.toggleSidebar },
      { id: "pane", label: "Show or hide changes and terminal", run: s.toggleRightPane },
      { id: "settings", label: "Settings", hint: "⌘,", run: () => s.setOverlay("settings") },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", run: () => s.setOverlay("shortcuts") },
    );
    for (const t of Object.values(tasks)) {
      list.push({
        id: `task-${t.id}`,
        label: displayTitle({ renames }, t),
        hint: STATE_LABELS[t.state],
        icon: <StateDot state={t.state} />,
        run: () => s.open(t.id),
      });
    }
    return list;
  }, [task, tasks, targets, renames]);
}

/** Search tasks and run any action from one box. */
export function CommandPalette() {
  const open = useSolus((s) => s.overlay === "palette");
  const setOverlay = useSolus((s) => s.setOverlay);
  useEffect(() => {
    if (open) void loadOpenTargets();
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => setOverlay(o ? "palette" : null)}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search tasks and actions</DialogDescription>
        {open && <Palette />}
      </DialogContent>
    </Dialog>
  );
}

function Palette() {
  const commands = useCommands();
  const setOverlay = useSolus((s) => s.setOverlay);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const matches = commands
    .flatMap((command) => {
      const score = matchScore(query, command.label);
      return score === null ? [] : [{ command, score }];
    })
    .sort((a, b) => a.score - b.score)
    .map((m) => m.command);
  const current = Math.min(selected, Math.max(0, matches.length - 1));

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOverlay(null);
    command.run();
  };

  useEffect(() => {
    list.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSelected(Math.min(matches.length - 1, current + 1));
            else if (e.key === "ArrowUp") setSelected(Math.max(0, current - 1));
            else if (e.key === "Enter") run(matches[current]);
            else return;
            e.preventDefault();
          }}
          placeholder="Search tasks and actions…"
          aria-label="Search tasks and actions"
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {matches.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
      ) : (
        <ul ref={list} className="no-scrollbar max-h-80 overflow-y-auto p-1.5">
          {matches.map((command, i) => (
            <li key={command.id}>
              <button
                type="button"
                onMouseMove={() => setSelected(i)}
                onClick={() => run(command)}
                className={cn("flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm", i === current && "bg-accent")}
              >
                {command.icon}
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {command.hint && <span className="shrink-0 text-xs text-muted-foreground">{command.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The shortcut sheet. */
export function ShortcutSheet() {
  const open = useSolus((s) => s.overlay === "shortcuts");
  const setOverlay = useSolus((s) => s.setOverlay);
  return (
    <Dialog open={open} onOpenChange={(o) => setOverlay(o ? "shortcuts" : null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">Every keyboard shortcut in Solus</DialogDescription>
        <div className="no-scrollbar grid max-h-[65vh] gap-x-8 gap-y-5 overflow-y-auto sm:grid-cols-2">
          {SHORTCUTS.map(({ group, items }) => (
            <section key={group}>
              <h3 className="pb-1.5 text-xs text-muted-foreground">{group}</h3>
              <dl className="space-y-1">
                {items.map(({ keys, label }) => (
                  <div key={label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="min-w-0">{label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((key) => (
                        <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs">
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
