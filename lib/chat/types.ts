export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_call?: ToolCallData | null;
  created_at: string;
}

export interface ToolCallData {
  type: "sql_read" | "sql_write" | "write_confirmed" | "write_rejected";
  sql: string;
  description: string;
  result?: unknown;
  error?: string;
}

export interface PendingWrite {
  messageId: string;
  sql: string;
  description: string;
}

export interface ChatConfig {
  appName: string;
  appDescription: string;
  /** App-specific context injected into the system prompt */
  domainContext: string;
}

/** Shape of the request body sent to POST /api/chat */
export interface ChatRequest {
  sessionId: string;
  message: string;
  userId: string;
  /** If set, execute this previously-pending write SQL */
  confirmWrite?: {
    sql: string;
    description: string;
  };
}

/** Streamed events from the chat API */
export type ChatStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use"; sql: string; description: string; isWrite: boolean }
  | { type: "tool_result"; result: unknown }
  | { type: "pending_write"; sql: string; description: string }
  | { type: "done"; assistantMessageId: string }
  | { type: "error"; message: string };
