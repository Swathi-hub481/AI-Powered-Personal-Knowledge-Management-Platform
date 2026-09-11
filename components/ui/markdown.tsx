"use client";

/**
 * Shared Markdown renderer used across the whole app.
 * Uses react-markdown + remark-gfm so AI responses (##, **, -, tables)
 * render as proper formatted HTML instead of raw asterisks/hashes.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownProps {
  content: string;
  /** Extra class names applied to the wrapper div */
  className?: string;
  /** Use compact spacing (for chat bubbles). Default: false */
  compact?: boolean;
}

const baseComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 w-full text-lg font-bold first:mt-0 [overflow-wrap:anywhere]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 w-full text-base font-bold first:mt-0 [overflow-wrap:anywhere]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 w-full text-sm font-semibold first:mt-0 [overflow-wrap:anywhere]">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 w-full leading-relaxed last:mb-0 [overflow-wrap:anywhere]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 w-full list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 w-full list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed [overflow-wrap:anywhere]">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre className="my-2 w-full max-w-full overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-slate-700">
          <code className="block font-mono [overflow-wrap:normal] [word-break:normal]">{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.82em] [overflow-wrap:anywhere] dark:bg-slate-700">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 w-full border-l-4 border-gray-300 pl-3 text-gray-600 italic [overflow-wrap:anywhere] dark:border-slate-500 dark:text-slate-300">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-200 dark:border-slate-600" />,
  table: ({ children }) => (
    <div className="my-2 w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50 dark:bg-slate-700">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold [overflow-wrap:anywhere] dark:border-slate-600">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-200 px-3 py-1.5 [overflow-wrap:anywhere] dark:border-slate-600">
      {children}
    </td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-verdant-700 underline [overflow-wrap:anywhere] hover:text-verdant-900 dark:text-emerald-400 dark:hover:text-emerald-300"
    >
      {children}
    </a>
  ),
};

export function Markdown({ content, className = "", compact = false }: MarkdownProps) {
  return (
    <div
      className={`w-full min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere] ${compact ? "" : "space-y-0.5"} ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={baseComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
