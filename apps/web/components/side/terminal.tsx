"use client";

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { Task } from "@solus/core";
import { resizeTerminal, writeTerminal } from "@/lib/actions";
import { useResolvedTheme } from "@/lib/hooks";
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
    brightYellow: c("var(--state-needs-input)"),
    blue: c("var(--state-working)"),
    brightBlue: c("var(--state-working)"),
    brightCyan: c("var(--state-working)"),
    brightBlack: c("var(--muted-foreground)"),
    // xterm's defaults are near-white, which vanishes on the light theme.
    white: c("var(--muted-foreground)"),
    brightWhite: c("var(--foreground)"),
  };
}

/** The task's terminal: agent commands, plus a real shell in its worktree once you click in. */
export function TerminalView({ task, source = "terminal" }: { task: Task; source?: "terminal" | "run" }) {
  const interactive = source === "terminal";
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const theme = useResolvedTheme();

  // xterm paints with fixed colours, so it needs telling when the theme changes.
  useEffect(() => {
    if (termRef.current && hostRef.current) termRef.current.options.theme = themeFrom(hostRef.current);
  }, [theme]);

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
        fontSize: 13,
        lineHeight: 1.35,
        cursorBlink: interactive,
        disableStdin: !interactive,
        convertEol: false,
        scrollback: 5000,
        theme: themeFrom(host),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      termRef.current = term;

      if (interactive) term.write(`\x1b[2mWorkspace ${task.branch}\x1b[0m\r\n`);
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
      const chunks = (s: ReturnType<typeof useSolus.getState>) => (interactive ? s.terminal : s.runOutput)[task.id];
      flush(chunks(useSolus.getState()));
      const unsubscribe = useSolus.subscribe((s) => flush(chunks(s)));

      // Keystrokes go to the worktree's shell, which starts when the terminal gets focus.
      const input = term.onData((data) => interactive && writeTerminal(task.id, data));
      const startShell = () => interactive && writeTerminal(task.id, "");
      term.textarea?.addEventListener("focus", startShell);
      const sizing = term.onResize(({ cols, rows }) => interactive && resizeTerminal(task.id, cols, rows));
      if (interactive) resizeTerminal(task.id, term.cols, term.rows);

      const resize = new ResizeObserver(() => fit.fit());
      resize.observe(host);

      cleanup = () => {
        unsubscribe();
        input.dispose();
        sizing.dispose();
        term.textarea?.removeEventListener("focus", startShell);
        resize.disconnect();
        termRef.current = null;
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [task.id, task.branch, interactive]);

  return (
    <section aria-label="Terminal" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 bg-card px-3 py-2">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </section>
  );
}
