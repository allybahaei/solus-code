import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const code = "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]";

const components: Components = {
  // Agents link to local files, which a browser can't open, so keep the name only.
  a: ({ href, children }) =>
    href && /^https?:/.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <code className={code} title={href}>
        {children}
      </code>
    ),
  // Images in agent replies would load from anywhere, so show where they point instead.
  img: ({ src, alt }) => (
    <code className={code} title={typeof src === "string" ? src : undefined}>
      {alt || "image"}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

/** Agent replies as GitHub-flavoured Markdown. Raw HTML in them is shown as text, never run. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="solus-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
