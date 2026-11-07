"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readFile, writeFile } from "@/lib/actions";

/** Edits one file in the worktree, in place of its diff. */
export function FileEditor({ taskId, path, onDone }: { taskId: string; path: string; onDone: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void readFile(taskId, path).then((text) => {
      if (!live) return;
      if (text === undefined) onDone();
      else setContent(text);
    });
    return () => {
      live = false;
    };
  }, [taskId, path, onDone]);

  if (content === null) return <p className="px-3 py-4 text-xs text-muted-foreground">Opening…</p>;

  const save = async () => {
    setSaving(true);
    await writeFile(taskId, path, content);
    onDone();
  };

  return (
    <div className="space-y-2 p-3">
      <Textarea
        autoFocus
        value={content}
        spellCheck={false}
        aria-label={`Edit ${path}`}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        className="h-96 resize-y font-mono text-[0.8125rem] leading-relaxed"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()} title="Save (⌘S)">
          Save
        </Button>
      </div>
    </div>
  );
}
