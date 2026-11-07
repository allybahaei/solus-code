/** What the text before the caret is asking for. */
export type MenuTrigger = { kind: "file"; query: string; start: number } | { kind: "command"; query: string };

export function menuTrigger(text: string, caret: number): MenuTrigger | null {
  const before = text.slice(0, caret);
  const command = /^\/(\S*)$/.exec(before);
  if (command) return { kind: "command", query: command[1] ?? "" };
  const file = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (file) return { kind: "file", query: file[1] ?? "", start: before.length - (file[1] ?? "").length - 1 };
  return null;
}

/** Swaps the @query being typed for the chosen file, leaving the caret after it. */
export function insertMention(text: string, caret: number, start: number, path: string): { text: string; caret: number } {
  const mention = `@${path} `;
  return { text: text.slice(0, start) + mention + text.slice(caret), caret: start + mention.length };
}

/** Splits a message into plain text and @file mentions, to show them as pills. */
export function splitMentions(text: string): { text: string; mention: boolean }[] {
  return text
    .split(/((?:^|(?<=\s))@[^\s@]+)/)
    .filter(Boolean)
    .map((part) => ({ text: part, mention: /^@[^\s@]+$/.test(part) }));
}

/** Every typed letter must appear in order, and tighter matches rank first. */
export function matchScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at !== -1) return at;
  let from = 0;
  let gaps = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i === -1) return null;
    gaps += i - from;
    from = i + 1;
  }
  return 100 + gaps;
}
