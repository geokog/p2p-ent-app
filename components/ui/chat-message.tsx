"use client";

import { Bot, User, AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import type { ChatMessage as ChatMessageType, PendingWrite } from "@/lib/chat/types";

interface ChatMessageProps {
  message: ChatMessageType;
  pendingWrite: PendingWrite | null;
  onConfirmWrite: () => void;
  onRejectWrite: () => void;
}

export function ChatMessage({
  message,
  pendingWrite,
  onConfirmWrite,
  onRejectWrite,
}: ChatMessageProps) {
  const [sqlExpanded, setSqlExpanded] = useState(false);
  const isUser = message.role === "user";
  const tc = message.tool_call;

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser ? "flex-row-reverse" : "")}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted border"
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      <div
        className={cn(
          "min-w-0 max-w-[85%] space-y-2",
          isUser ? "items-end" : "items-start"
        )}
      >
        {/* SQL query block (collapsible) */}
        {tc && tc.sql && (
          <div className="rounded-md border bg-muted/50 text-xs">
            <button
              onClick={() => setSqlExpanded(!sqlExpanded)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground"
            >
              {sqlExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {tc.description || "SQL Query"}
            </button>
            {sqlExpanded && (
              <pre className="border-t px-3 py-2 overflow-x-auto text-[11px] leading-relaxed">
                <code>{tc.sql}</code>
              </pre>
            )}
          </div>
        )}

        {/* Message content */}
        {message.content && (
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm leading-relaxed",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-foreground"
            )}
          >
            <MessageContent content={message.content} isUser={isUser} />
          </div>
        )}

        {/* Write confirmation card */}
        {tc?.type === "sql_write" &&
          pendingWrite &&
          pendingWrite.messageId === message.id && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                <AlertTriangle className="size-4" />
                Write operation requires confirmation
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={onConfirmWrite}
                  className="gap-1.5 bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="size-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRejectWrite}
                  className="gap-1.5"
                >
                  <XCircle className="size-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          )}

        {/* Write result indicator */}
        {tc?.type === "write_confirmed" && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="size-3.5" />
            Write executed
          </div>
        )}
        {tc?.type === "write_rejected" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <XCircle className="size-3.5" />
            Write cancelled
          </div>
        )}
      </div>
    </div>
  );
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1.5 text-sm font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        a: ({ href, children }) => (
          <a href={href} className="underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="my-2 overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                <code className={className} {...props}>{children}</code>
              </pre>
            );
          }
          return (
            <code
              className={cn(
                "rounded px-1 py-0.5 text-[11px] font-mono",
                isUser ? "bg-primary-foreground/20" : "bg-muted"
              )}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b font-medium">{children}</thead>,
        tbody: ({ children }) => <tbody className="divide-y">{children}</tbody>,
        tr: ({ children }) => <tr>{children}</tr>,
        th: ({ children }) => <th className="px-2 py-1 text-left">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic">{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-muted-foreground/20" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
