"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Composer, COMPOSER_ID } from "@/components/chat/composer";
import { TabBar } from "@/components/chat/tab-bar";
import { TaskHeader } from "@/components/chat/task-header";
import { Transcript } from "@/components/chat/transcript";
import { Home } from "@/components/home";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { Changes } from "@/components/side/changes";
import { TerminalView } from "@/components/side/terminal";
import { SEARCH_ID, Sidebar } from "@/components/sidebar";
import { mergeTask, openPullRequest, startTask } from "@/lib/actions";
import { useMediaQuery } from "@/lib/hooks";
import { getRunner } from "@/lib/runner";
import { connectRunner, useSolus, type CenterView } from "@/lib/store";
import { cn } from "@/lib/utils";

const EMPTY: never[] = [];

export function AppShell() {
  const showList = useSolus((s) => s.showList);
  const wide = useMediaQuery("(min-width: 1024px)");
  const rightPaneOpen = useSolus((s) => s.rightPaneOpen);

  useEffect(() => connectRunner(getRunner()), []);
  useKeyboard();

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden">
      <aside
        className={cn(
          "min-h-0 w-full flex-col border-r bg-card md:flex md:w-72 md:shrink-0",
          showList ? "flex" : "hidden",
        )}
      >
        <Sidebar />
      </aside>
      <main className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", showList ? "hidden" : "flex")}>
        <TabBar />
        <ActiveTask wide={wide} />
      </main>
      {wide && rightPaneOpen && <RightPane />}
      <NewTaskDialog />
      <Notice />
    </div>
  );
}

function ActiveTask({ wide }: { wide: boolean }) {
  const task = useSolus((s) => (s.activeId ? s.tasks[s.activeId] : undefined));
  const messages = useSolus((s) => (s.activeId ? s.messages[s.activeId] : undefined)) ?? EMPTY;
  const files = useSolus((s) => (s.activeId ? s.diffs[s.activeId] : undefined)) ?? EMPTY;
  const status = useSolus((s) => s.status);
  const error = useSolus((s) => s.error);
  const view = useSolus((s) => s.centerView);
  const setView = useSolus((s) => s.setCenterView);

  if (status === "error") {
    return <Empty>Couldn&apos;t reach the runner: {error}</Empty>;
  }
  if (!task) {
    return status === "connecting" ? <Empty>{""}</Empty> : <Home />;
  }

  const current: CenterView = wide ? "chat" : view;
  return (
    <>
      <TaskHeader task={task} />
      {!wide && (
        <div role="tablist" className="flex shrink-0 gap-1 border-b px-3 py-1.5">
          {(["chat", "changes", "terminal"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={current === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs capitalize",
                current === v ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
              {v === "changes" && files.length > 0 && <span className="ml-1 tabular-nums">{files.length}</span>}
            </button>
          ))}
        </div>
      )}
      {current === "chat" && (
        <>
          <Transcript task={task} messages={messages} />
          <Composer key={task.id} task={task} />
        </>
      )}
      {current === "changes" && <Changes task={task} files={files} />}
      {current === "terminal" && <TerminalView key={task.id} task={task} />}
    </>
  );
}

function RightPane() {
  const task = useSolus((s) => (s.activeId ? s.tasks[s.activeId] : undefined));
  const files = useSolus((s) => (s.activeId ? s.diffs[s.activeId] : undefined)) ?? EMPTY;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l xl:w-[440px]">
      {task ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <Changes key={task.id} task={task} files={files} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t">
            <TerminalView key={task.id} task={task} />
          </div>
        </>
      ) : null}
    </aside>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Notice() {
  const notice = useSolus((s) => s.notice);
  const setNotice = useSolus((s) => s.setNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);
  if (!notice) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-3.5 py-2 text-sm shadow-lg"
    >
      {notice}
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-muted-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * J/K or ↑/↓ move through workspaces, [ ] switch tabs, X closes a tab,
 * N new task, Enter focuses the reply box, S start, M merge, P open PR.
 * Ignored while typing.
 */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;

      const s = useSolus.getState();
      const task = s.activeId ? s.tasks[s.activeId] : undefined;
      const handled = (() => {
        switch (e.key) {
          case "j":
          case "ArrowDown":
            s.move(1);
            return true;
          case "k":
          case "ArrowUp":
            s.move(-1);
            return true;
          case "]":
            s.cycleTab(1);
            return true;
          case "[":
            s.cycleTab(-1);
            return true;
          case "x":
            if (s.activeId) s.closeTab(s.activeId);
            return true;
          case "n":
            s.setNewTaskOpen(true);
            return true;
          case "/":
            if (s.query === null) s.setQuery("");
            else document.getElementById(SEARCH_ID)?.focus();
            return true;
          case "Enter":
            if (!task) return false;
            if (s.centerView !== "chat" || s.showList) {
              s.open(task.id);
              requestAnimationFrame(() => document.getElementById(COMPOSER_ID)?.focus());
            } else {
              document.getElementById(COMPOSER_ID)?.focus();
            }
            return true;
          case "s":
            if (task?.state === "idle") void startTask(task.id);
            return true;
          case "m":
            if (task?.state === "ready_for_review") void mergeTask(task.id);
            return true;
          case "p":
            if (task?.state === "ready_for_review") void openPullRequest(task.id);
            return true;
          default:
            return false;
        }
      })();
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
