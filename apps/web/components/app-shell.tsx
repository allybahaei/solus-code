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
import { MergeDialog } from "@/components/review/merge-dialog";
import { REVIEW_SUMMARY_ID, ReviewView, sortFiles } from "@/components/review/review-view";
import { startTask } from "@/lib/actions";
import { loadReviewPrefs, useReview } from "@/lib/review-store";
import { useMediaQuery } from "@/lib/hooks";
import { getConnection, getRunner } from "@/lib/runner";
import { connectRunner, useSolus, type CenterView } from "@/lib/store";
import { cn } from "@/lib/utils";

const EMPTY: never[] = [];

export function AppShell() {
  const showList = useSolus((s) => s.showList);
  const wide = useMediaQuery("(min-width: 1024px)");
  const rightPaneOpen = useSolus((s) => s.rightPaneOpen);

  useEffect(() => connectRunner(getRunner(), getConnection()), []);
  useEffect(() => loadReviewPrefs(), []);
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
        <ConnectionBanner />
        <TabBar />
        <ActiveTask wide={wide} />
      </main>
      {wide && rightPaneOpen && <RightPane />}
      <NewTaskDialog />
      <MergeDialog />
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
  const reviewing = useReview((s) => (task ? s.view[task.id] === "review" : false));

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
      {current === "chat" &&
        (wide && reviewing ? (
          <ReviewView key={task.id} task={task} files={files} narrow={false} />
        ) : (
          <>
            <Transcript task={task} messages={messages} />
            <Composer key={task.id} task={task} />
          </>
        ))}
      {current === "changes" && <ReviewView key={task.id} task={task} files={files} narrow />}
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

function ConnectionBanner() {
  const connected = useSolus((s) => s.connected);
  const loaded = useSolus((s) => s.status === "ready");
  if (connected) return null;
  return (
    <div role="status" className="shrink-0 border-b bg-state-needs-input-soft px-4 py-1.5 text-xs">
      {loaded
        ? "Lost the connection to the Solus daemon. Reconnecting…"
        : "Can't reach the Solus daemon. Is it running? Retrying…"}
    </div>
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
 * J/K or ↑/↓ move through workspaces (or files, while reviewing), [ ] switch
 * tabs, X closes a tab, N new task, Enter focuses the reply box, S start,
 * R review, V mark the file in view as viewed, M merge, P open PR, Esc back
 * to the chat. Ignored while typing or while a dialog is open.
 */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;

      const s = useSolus.getState();
      const task = s.activeId ? s.tasks[s.activeId] : undefined;
      const r = useReview.getState();
      const reviewing = !!task && (r.view[task.id] === "review" || s.centerView === "changes");

      /** Scrolls the review to the next or previous file. */
      const stepFile = (delta: 1 | -1) => {
        if (!task) return;
        const paths = sortFiles(s.diffs[task.id] ?? []).map((f) => f.path);
        const i = r.inView ? paths.indexOf(r.inView) : -1;
        const next = paths[Math.min(paths.length - 1, Math.max(0, i + delta))];
        if (next) r.showFile(task.id, next);
      };

      const handled = (() => {
        switch (e.key) {
          case "j":
          case "ArrowDown":
            if (reviewing) stepFile(1);
            else s.move(1);
            return true;
          case "k":
          case "ArrowUp":
            if (reviewing) stepFile(-1);
            else s.move(-1);
            return true;
          case "r":
            if (!task) return false;
            if (window.matchMedia("(min-width: 1024px)").matches) r.setView(task.id, "review");
            else s.setCenterView("changes");
            return true;
          case "v":
            if (task && reviewing && r.inView) r.toggleViewed(task.id, r.inView);
            return true;
          case "Escape":
            if (task && r.view[task.id] === "review") {
              r.setView(task.id, "chat");
              return true;
            }
            return false;
          case "c":
            if (task && reviewing) document.getElementById(REVIEW_SUMMARY_ID)?.focus();
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
            if (s.centerView !== "chat" || s.showList || r.view[task.id] === "review") {
              r.setView(task.id, "chat");
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
            if (task?.state === "ready_for_review") r.openMerge(task.id, "merge");
            return true;
          case "p":
            if (task?.state === "ready_for_review") r.openMerge(task.id, "pr");
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
