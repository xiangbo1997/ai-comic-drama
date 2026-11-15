"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere] break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 text-lg font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 text-base font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 font-semibold">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="whitespace-pre-wrap">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-primary/40 text-muted-foreground border-l-2 pl-3">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="bg-background max-w-full overflow-x-auto rounded-md p-3 text-xs">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="bg-background/70 rounded px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="border-border w-full border-collapse border text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-border bg-background/50 border px-2 py-1.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-border border px-2 py-1.5 align-top">
              {children}
            </td>
          ),
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          // 外部回复图片不自动发请求，避免跟踪像素及挤坏聊天布局。
          img: ({ alt }) => (
            <span className="text-muted-foreground">
              {alt ? `[图片：${alt}]` : "[图片]"}
            </span>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
