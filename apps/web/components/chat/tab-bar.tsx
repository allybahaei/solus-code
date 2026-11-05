"use client";

import { ChevronLeft, Plus, X } from "lucide-react";
import { StateDot } from "@/components/state-dot";
import { Button } from "@/components/ui/button";
import { useSolus } from "@/lib/store";
import { cn } from "@/lib/utils";

export function TabBar() {
  const openTabs = useSolus((s) => s.openTabs);
  const activeId = useSolus((s) => s.activeId);
  const tasks = useSolus((s) => s.tasks);
  const open = useSolus((s) => s.open);
  const closeTab = useSolus((s) => s.closeTab);
  const setShowList = useSolus((s) => s.setShowList);
  const setNewTaskOpen = useSolus((s) => s.setNewTaskOpen);

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b">
      <Button
        variant="ghost"
        size="icon-sm"
        className="my-auto ml-1 md:hidden"
        onClick={() => setShowList(true)}
        aria-label="Back to workspaces"
      >
        <ChevronLeft />
      </Button>
      <div role="tablist" aria-label="Open workspaces" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {openTabs.map((id) => {
          const task = tasks[id];
          if (!task) return null;
          const active = id === activeId;
          return (
            <div
              key={id}
              className={cn(
                "group relative flex max-w-56 min-w-28 shrink-0 items-center border-r text-sm",
                active ? "bg-background text-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {active && <span className="absolute inset-x-0 bottom-0 h-px bg-foreground/60" />}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => open(id)}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 pl-3 focus-visible:outline-none"
              >
                <StateDot state={task.state} />
                <span className="truncate">{task.title}</span>
              </button>
              <button
                type="button"
                onClick={() => closeTab(id)}
                aria-label={`Close ${task.title}`}
                className={cn(
                  "mr-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                  !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="icon-sm"
          className="mx-1 my-auto shrink-0"
          onClick={() => setNewTaskOpen(true)}
          aria-label="New task"
          title="New task (N)"
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}
