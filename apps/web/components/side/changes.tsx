"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { DiffFile, Task } from "@solus/core";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<DiffFile["status"], { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-diff-add", label: "Added" },
  modified: { letter: "M", className: "text-state-needs-input", label: "Modified" },
  deleted: { letter: "D", className: "text-diff-del", label: "Deleted" },
  renamed: { letter: "R", className: "text-state-working", label: "Renamed" },
};

/** Files changed in the task's worktree. Click a file to see its patch. */
export function Changes({ task, files }: { task: Task; files: DiffFile[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section aria-label="Changes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <span className="font-medium">Changes</span>
        <span className="text-muted-foreground tabular-nums">{files.length}</span>
        {files.length > 0 && (
          <span className="ml-auto font-mono text-xs tabular-nums">
            <span className="text-diff-add">+{task.changes.additions}</span>{" "}
            <span className="text-diff-del">−{task.changes.deletions}</span>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {task.state === "idle" ? "Changes appear here once the agent starts editing." : "No changes yet."}
          </p>
        ) : (
          <ul>
            {[...files]
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((f) => (
                <FileRow key={f.path} file={f} open={open === f.path} onToggle={() => setOpen(open === f.path ? null : f.path)} />
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FileRow({ file, open, onToggle }: { file: DiffFile; open: boolean; onToggle: () => void }) {
  const [dir, name] = splitPath(file.path);
  const status = STATUS[file.status];
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={file.path}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="flex min-w-0 flex-1 font-mono">
          <span className="truncate text-muted-foreground">{dir}</span>
          <span className="shrink-0">{name}</span>
        </span>
        <span className="shrink-0 font-mono tabular-nums">
          {file.additions > 0 && <span className="text-diff-add">+{file.additions}</span>}{" "}
          {file.deletions > 0 && <span className="text-diff-del">−{file.deletions}</span>}
        </span>
        <span className={cn("w-3 shrink-0 text-center font-mono font-semibold", status.className)} title={status.label}>
          {status.letter}
        </span>
      </button>
      {open && <Patch patch={file.patch} />}
    </li>
  );
}

/** Plain unified view; the Review screen gets a proper diff viewer. */
function Patch({ patch }: { patch: string }) {
  const lines = patch.split("\n").filter((l) => !/^(diff --git|new file mode|--- |\+\+\+ |rename )/.test(l));
  return (
    <pre className="mx-3 my-1 overflow-x-auto rounded-md border bg-muted/40 py-1 font-mono text-[11px] leading-5">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "px-2 whitespace-pre",
            l.startsWith("+") && "bg-diff-add/10 text-diff-add",
            l.startsWith("-") && "bg-diff-del/10 text-diff-del",
            l.startsWith("@@") && "text-muted-foreground",
          )}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}
