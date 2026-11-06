"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Task } from "@solus/core";
import { resizeTerminal, writeTerminal } from "@/lib/actions";
import { useSolus } from "@/lib/store";

/** Resolves any CSS colour (oklch, light-dark(), var()) to #rrggbb, which xterm needs. */
function cssToHex(el: HTMLElement, value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  el.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function themeFrom(el: HTMLElement) {
  const c = (v: string) => cssToHex(el, v);
  return {
    background: c("var(--card)"),
    foreground: c("var(--foreground)"),
    cursor: c("var(--muted-foreground)"),
    selectionBackground: c("color-mix(in oklch, var(--ring) 35%, transparent)"),
    green: c("var(--diff-add)"),
    brightGreen: c("var(--diff-add)"),
    red: c("var(--diff-del)"),
    brightRed: c("var(--diff-del)"),
    yellow: c("var(--state-needs-input)"),
    blue: c("var(--state-working)"),
    brightBlack: c("var(--muted-foreground)"),
  };
}

/** The task's terminal: agent commands, plus a real shell in its worktree once you click in. */
export function TerminalView({ task }: { task: Task }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;

      const term = new Terminal({
        fontFamily: getComputedStyle(host).getPropertyValue("--font-geist-mono") || "monospace",
        fontSize: 12,
        lineHeight: 1.35,
        cursorBlink: true,
        convertEol: false,
        scrollback: 5000,
        theme: themeFrom(host),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();

      term.write(`\x1b[2mWorkspace ${task.branch}\x1b[0m\r\n`);
      let written = 0;
      const flush = (chunks: string[] | undefined) => {
        if (!chunks) return;
        if (chunks.length < written) {
          // The daemon restarted, so this is a new history.
          term.reset();
          written = 0;
        }
        for (; written < chunks.length; written++) term.write(chunks[written] ?? "");
      };
      flush(useSolus.getState().terminal[task.id]);
      const unsubscribe = useSolus.subscribe((s) => flush(s.terminal[task.id]));

      // Keystrokes go to the worktree's shell, which starts when the terminal gets focus.
      const input = term.onData((data) => writeTerminal(task.id, data));
      const startShell = () => writeTerminal(task.id, "");
      term.textarea?.addEventListener("focus", startShell);
      const sizing = term.onResize(({ cols, rows }) => resizeTerminal(task.id, cols, rows));
      resizeTerminal(task.id, term.cols, term.rows);

      const resize = new ResizeObserver(() => fit.fit());
      resize.observe(host);

      const scheme = window.matchMedia("(prefers-color-scheme: dark)");
      const retheme = () => (term.options.theme = themeFrom(host));
      scheme.addEventListener("change", retheme);

      cleanup = () => {
        unsubscribe();
        input.dispose();
        sizing.dispose();
        term.textarea?.removeEventListener("focus", startShell);
        resize.disconnect();
        scheme.removeEventListener("change", retheme);
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [task.id, task.branch]);

  return (
    <section aria-label="Terminal" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b px-3 text-sm font-medium">Terminal</div>
      <div className="min-h-0 flex-1 bg-card px-3 py-2">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </section>
  );
}
