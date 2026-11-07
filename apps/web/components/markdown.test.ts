import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

/** The reply that showed raw symbols with the old renderer. */
const REPLY = [
  "Here's a summary of the backend architecture:",
  "",
  "## Backend Structure",
  "",
  "### 1. Next.js API Routes (`/app/api/`)",
  "Thin routes for user-facing operations:",
  "- **Feedback** — sends emails via Resend",
  "- **`/api/courses`** — outline generation",
].join("\n");

describe("Markdown", () => {
  it("renders headings, lists under a line of text, and code inside bold", () => {
    const out = html(REPLY);
    expect(out).toContain("<h2>Backend Structure</h2>");
    expect(out).toContain("<h3>1. Next.js API Routes (<code>/app/api/</code>)</h3>");
    expect(out).toContain("<li><strong>Feedback</strong> — sends emails via Resend</li>");
    expect(out).toContain("<strong><code>/api/courses</code></strong>");
    expect(out).not.toMatch(/##|\*\*|`/);
  });

  it("colours code blocks with a language", () => {
    expect(html("```ts\nconst a = 1;\n```")).toMatch(/<pre><code class="hljs language-ts"><span class="hljs-keyword">const<\/span>/);
  });

  it("renders tables and task lists", () => {
    const out = html("| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done");
    expect(out).toContain("<table>");
    expect(out).toContain('type="checkbox"');
  });

  it("keeps web links, and shows local file links as names", () => {
    expect(html("[docs](https://example.com)")).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>');
    expect(html("[notes.txt](/tmp/work/notes.txt)")).toContain('<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" title="/tmp/work/notes.txt">notes.txt</code>');
  });

  it("never runs raw HTML or loads images", () => {
    const out = html('<img src=x onerror="alert(1)"> <script>alert(1)</script>\n\n![tracker](https://evil.example/p.png)');
    // Shown as escaped text: no real tag, so nothing loads or runs.
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toMatch(/<(script|img)\b/);
    expect(out).not.toMatch(/<[^>]*\sonerror=/);
  });
});
