import { useEffect, useRef, useState } from "react";

/** The steady pace, in characters a second. */
const PACE = 90;
/** Any backlog clears in about this long, so text never trails far behind the agent. */
const CATCH_UP_SECONDS = 2;
/** A timer, not animation frames, which stop for a window that's covered or hidden. */
const TICK_MS = 30;

/** How far the reveal should be after `ms`, never past `target`. */
export function advance(shown: number, target: number, ms: number): number {
  const perSecond = Math.max(PACE, (target - shown) / CATCH_UP_SECONDS);
  return Math.min(target, shown + (perSecond * ms) / 1000);
}

/** Closes bold and code left open by a cut, so they format while typing instead of showing symbols. */
export function closeOpenMarkup(text: string): string {
  const bold = text.split("**").length - 1;
  const code = text.split("`").length - 1;
  const trimmed = text.endsWith("*") && !text.endsWith("**") ? text.slice(0, -1) : text;
  return trimmed + (code % 2 ? "`" : "") + (bold % 2 ? "**" : "");
}

function prefersStillness(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveals `text` at a steady pace as it grows, however it arrives: word by word
 * or all at once. `fromStart` is false for text that was already there, which
 * shows at once and only types what comes after it.
 */
export function useTypedText(text: string, fromStart: boolean, onType?: () => void): string {
  const start = fromStart ? 0 : text.length;
  const shown = useRef(start);
  const [length, setLength] = useState(start);
  const [still] = useState(prefersStillness);
  const callback = useRef(onType);

  useEffect(() => {
    callback.current = onType;
  });

  useEffect(() => {
    if (still || shown.current >= text.length) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      shown.current = advance(shown.current, text.length, now - last);
      last = now;
      setLength(Math.floor(shown.current));
      if (shown.current >= text.length) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [text.length, still]);

  useEffect(() => {
    callback.current?.();
  }, [length]);

  return still || length >= text.length ? text : closeOpenMarkup(text.slice(0, length));
}
