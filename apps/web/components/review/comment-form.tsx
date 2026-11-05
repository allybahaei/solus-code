"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Inline box for writing or editing a line comment. */
export function CommentForm({
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = () => {
    if (text.trim()) onSubmit(text.trim());
  };
  return (
    <div className="space-y-2 border-y bg-card px-3 py-2.5 font-sans">
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder="Leave a comment for the agent…"
        rows={3}
        className="min-h-20 resize-none text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">⌘Enter to save · Esc to cancel</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
