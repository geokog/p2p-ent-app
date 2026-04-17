"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSession, ChatMessage, PendingWrite, ChatStreamEvent } from "./types";
import { useAuth } from "@/lib/auth-context";

function generateId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now()}_${hex}`;
}

export function useChat() {
  const { user } = useAuth();
  const userId = user?.id ?? "user-1";
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadSessions();
    setActiveSessionId(null);
    setMessages([]);
  }, [userId]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/sessions?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {
      // Silently fail — sessions will be empty
    }
  }, []);

  const createSession = useCallback(async (): Promise<string> => {
    const id = generateId("ses");
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, userId }),
      });
      if (res.ok) {
        const session = await res.json();
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(id);
        setMessages([]);
        setPendingWrite(null);
        return id;
      }
    } catch {
      // Fall through
    }
    return id;
  }, []);

  const switchSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setPendingWrite(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (res.ok) {
        const { messages: msgs } = await res.json();
        setMessages(msgs);
      }
    } catch {
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await fetch(`/api/chat/sessions/${sessionId}`, { method: "DELETE" });
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setMessages([]);
          setPendingWrite(null);
        }
      } catch {
        // Silently fail
      }
    },
    [activeSessionId]
  );

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
        );
      }
    } catch {
      // Silently fail
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      let sessionId = activeSessionId;

      // Auto-create a session if none active
      if (!sessionId) {
        sessionId = await createSession();
      }

      // Optimistically add user message
      const userMsg: ChatMessage = {
        id: generateId("msg"),
        session_id: sessionId,
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setPendingWrite(null);

      // Placeholder for assistant response
      const assistantMsgId = generateId("msg");
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        session_id: sessionId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        abortRef.current = new AbortController();
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: content,
            userId,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error("Failed to send message");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event: ChatStreamEvent = JSON.parse(line.slice(6));
              handleStreamEvent(event, assistantMsgId, sessionId);
            } catch {
              // Skip malformed events
            }
          }
        }

        // Process remaining buffer
        if (buffer.startsWith("data: ")) {
          try {
            const event: ChatStreamEvent = JSON.parse(buffer.slice(6));
            handleStreamEvent(event, assistantMsgId, sessionId);
          } catch {
            // Skip
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: "Sorry, an error occurred. Please try again." }
                : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [activeSessionId, createSession]
  );

  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent, assistantMsgId: string, sessionId: string) => {
      switch (event.type) {
        case "text":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + event.content }
                : m
            )
          );
          break;

        case "pending_write":
          setPendingWrite({
            messageId: assistantMsgId,
            sql: event.sql,
            description: event.description,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    tool_call: {
                      type: "sql_write" as const,
                      sql: event.sql,
                      description: event.description,
                    },
                  }
                : m
            )
          );
          break;

        case "tool_result":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    tool_call: {
                      ...(m.tool_call || { type: "sql_read" as const, sql: "", description: "" }),
                      result: event.result,
                    },
                  }
                : m
            )
          );
          break;

        case "done":
          // Refresh session list for updated timestamps/titles
          loadSessions();
          void sessionId;
          break;

        case "error":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: m.content || `Error: ${event.message}`,
                  }
                : m
            )
          );
          break;
      }
    },
    [loadSessions]
  );

  const confirmWriteAction = useCallback(async () => {
    if (!pendingWrite || !activeSessionId) return;

    setIsStreaming(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: "",
          userId,
          confirmWrite: {
            sql: pendingWrite.sql,
            description: pendingWrite.description,
          },
        }),
      });

      if (res.ok) {
        const result = await res.json();
        const confirmMsg: ChatMessage = {
          id: generateId("msg"),
          session_id: activeSessionId,
          role: "assistant",
          content: result.success
            ? `Write operation completed successfully.\n\n**${pendingWrite.description}**`
            : `Write operation failed: ${result.error}`,
          tool_call: {
            type: "write_confirmed",
            sql: pendingWrite.sql,
            description: pendingWrite.description,
            result: result.result,
            error: result.error,
          },
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, confirmMsg]);

        if (result.success) {
          window.dispatchEvent(new CustomEvent("chat-data-changed"));
        }
      }
    } catch {
      // Silently fail
    } finally {
      setPendingWrite(null);
      setIsStreaming(false);
    }
  }, [pendingWrite, activeSessionId]);

  const rejectWriteAction = useCallback(() => {
    if (!pendingWrite) return;
    const rejectMsg: ChatMessage = {
      id: generateId("msg"),
      session_id: activeSessionId || "",
      role: "assistant",
      content: "Write operation was cancelled by user.",
      tool_call: {
        type: "write_rejected",
        sql: pendingWrite.sql,
        description: pendingWrite.description,
      },
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, rejectMsg]);
    setPendingWrite(null);
  }, [pendingWrite, activeSessionId]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    sessions,
    activeSessionId,
    messages,
    isLoading,
    isStreaming,
    pendingWrite,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    sendMessage,
    confirmWriteAction,
    rejectWriteAction,
    stopStreaming,
    loadSessions,
  };
}
