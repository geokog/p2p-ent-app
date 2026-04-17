"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";
import {
  MessageSquare,
  X,
  Plus,
  Trash2,
  Send,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChat } from "@/lib/chat/use-chat";
import { ChatMessage } from "./chat-message";
import { Button } from "./button";
import { Input } from "./input";
import { ScrollArea } from "./scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 420;

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const {
    sessions,
    activeSessionId,
    messages,
    isLoading,
    isStreaming,
    pendingWrite,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    confirmWriteAction,
    rejectWriteAction,
  } = useChat();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(next);
    };

    const onMouseUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      setIsDragging(true);
    },
    [panelWidth]
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const val = inputValue.trim();
      if (!val || isStreaming) return;
      setInputValue("");
      sendMessage(val);
    },
    [inputValue, isStreaming, sendMessage]
  );

  const handleNewChat = useCallback(async () => {
    await createSession();
    inputRef.current?.focus();
  }, [createSession]);

  return (
    <TooltipProvider>
      {/* Toggle button — fixed bottom-right */}
      {!isOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => setIsOpen(true)}
              className="fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg"
              size="icon"
            >
              <MessageSquare className="size-5" />
              <span className="sr-only">Open AI Assistant</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">AI Assistant</TooltipContent>
        </Tooltip>
      )}

      {/* Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex bg-background shadow-xl",
          isOpen ? "translate-x-0" : "translate-x-full",
          !isDragging && "transition-transform duration-300 ease-in-out"
        )}
        style={{ width: panelWidth }}
      >
        {/* Drag handle */}
        <div
          className="absolute inset-y-0 left-0 z-50 w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
          onMouseDown={handleDragStart}
        />

        {/* Left sidebar strip — always visible, expands on toggle */}
        <div className="flex shrink-0 flex-col border-r bg-muted/30">
          {/* Sidebar header with toggle on the right */}
          <div className="flex items-center justify-end border-b px-1.5 py-2.5">
            {sidebarOpen && (
              <>
                <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Chats
                </span>
                {sessions.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (window.confirm("Delete all chat sessions?")) {
                            sessions.forEach((s) => deleteSession(s.id));
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete all</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={handleNewChat}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New chat</TooltipContent>
                </Tooltip>
              </>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="size-4" />
                  ) : (
                    <PanelLeftOpen className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {sidebarOpen ? "Hide sessions" : "Show sessions"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Session list — only when expanded */}
          {sidebarOpen && (
            <ScrollArea className="flex-1">
              <div className="w-[180px] space-y-0.5 p-1.5">
                {sessions.length === 0 && (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No conversations yet.
                    <br />
                    Start one below!
                  </div>
                )}
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      "group flex items-center rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-muted",
                      activeSessionId === session.id && "bg-muted font-medium"
                    )}
                    onClick={() => switchSession(session.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {session.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Main chat area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
            <div className="flex-1 text-sm font-medium">
              {activeSessionId
                ? sessions.find((s) => s.id === activeSessionId)?.title ||
                  "Chat"
                : "AI Assistant"}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </div>

          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <MessageSquare className="size-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Ask me anything</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    I can query the database, look up charts,
                    <br />
                    and help with data analysis.
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {[
                    "How many items are pending?",
                    "What's the average value?",
                    "Show items assigned to me",
                  ].map((q) => (
                    <button
                      key={q}
                      className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      onClick={() => {
                        setInputValue(q);
                        inputRef.current?.focus();
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y">
                {messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    pendingWrite={pendingWrite}
                    onConfirmWrite={confirmWriteAction}
                    onRejectWrite={rejectWriteAction}
                  />
                ))}
                {isStreaming && messages[messages.length - 1]?.content === "" && (
                  <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Thinking...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t p-3">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask a question..."
                className="h-9 text-sm"
                disabled={isStreaming}
              />
              <Button
                type="submit"
                size="icon"
                className="size-9 shrink-0"
                disabled={!inputValue.trim() || isStreaming}
              >
                {isStreaming ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Backdrop overlay when panel is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </TooltipProvider>
  );
}
