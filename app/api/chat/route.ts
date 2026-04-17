import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { getDatabaseSchema } from "@/lib/chat/schema";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { APP_CHAT_CONFIG } from "@/lib/chat/app-context";
import type { ChatRequest, ToolCallData } from "@/lib/chat/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SQL_TOOL: Anthropic.Tool = {
  name: "run_sql",
  description:
    "Execute a SQL query against the PostgreSQL database. Use SELECT for read queries. For INSERT/UPDATE/DELETE, describe the change and the system will ask the user for confirmation before executing.",
  input_schema: {
    type: "object" as const,
    properties: {
      sql: {
        type: "string",
        description: "The SQL query to execute",
      },
      description: {
        type: "string",
        description: "A short human-readable description of what this query does",
      },
    },
    required: ["sql", "description"],
  },
};

const DANGEROUS_PATTERNS = /^\s*(DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\s/i;

function isWriteQuery(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return (
    trimmed.startsWith("INSERT") ||
    trimmed.startsWith("UPDATE") ||
    trimmed.startsWith("DELETE")
  );
}

function generateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `msg_${Date.now()}_${hex}`;
}

async function executeSQL(sql: string): Promise<{ data?: unknown; error?: string }> {
  const sb = supabaseAdmin;
  if (!sb) return { error: "Database not configured" };

  if (DANGEROUS_PATTERNS.test(sql)) {
    return { error: "DDL statements (DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE) are not allowed." };
  }

  try {
    if (isWriteQuery(sql)) {
      const { data, error } = await sb.rpc("exec_write_sql", { query: sql });
      if (error) return { error: error.message };
      return { data };
    } else {
      const { data, error } = await sb.rpc("exec_sql", { query: sql });
      if (error) return { error: error.message };
      return { data };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function saveMessage(
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolCall?: ToolCallData
): Promise<string> {
  const id = generateId();
  const sb = supabaseAdmin;
  if (sb) {
    await sb.from("chat_messages").insert({
      id,
      session_id: sessionId,
      role,
      content,
      tool_call: toolCall || null,
    });
  }
  return id;
}

async function autoTitleSession(sessionId: string, userMessage: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;

  try {
    const titleResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `Generate a very short title (3-6 words, no quotes) for a conversation that starts with this question: "${userMessage}"`,
        },
      ],
    });
    const title =
      titleResponse.content[0].type === "text"
        ? titleResponse.content[0].text.trim()
        : "New conversation";

    await sb
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch {
    // Non-critical — leave default title
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequest;
  const { sessionId, message, confirmWrite } = body;

  const sb = supabaseAdmin;
  if (!sb) {
    return new Response(
      JSON.stringify({ error: "Database not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle write confirmation
  if (confirmWrite) {
    const result = await executeSQL(confirmWrite.sql);
    const toolCallData: ToolCallData = {
      type: "write_confirmed",
      sql: confirmWrite.sql,
      description: confirmWrite.description,
      result: result.data,
      error: result.error,
    };
    const msgId = await saveMessage(sessionId, "tool", result.error ? `Error: ${result.error}` : "Write executed successfully.", toolCallData);

    return new Response(
      JSON.stringify({
        type: "write_result",
        success: !result.error,
        result: result.data,
        error: result.error,
        messageId: msgId,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Save user message
  await saveMessage(sessionId, "user", message);

  // Check if this is the first user message — auto-title
  const { count } = await sb
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("role", "user");

  if (count === 1) {
    autoTitleSession(sessionId, message).catch(() => {});
  }

  // Load conversation history
  const { data: history } = await sb
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const claudeMessages: Anthropic.MessageParam[] = (history || [])
    .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
    .map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Build system prompt
  const schema = await getDatabaseSchema();
  const systemPrompt = buildSystemPrompt(schema, APP_CHAT_CONFIG);

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        let fullResponse = "";
        let toolCallData: ToolCallData | undefined;

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          tools: [SQL_TOOL],
          messages: claudeMessages,
        });

        // Process content blocks
        for (const block of response.content) {
          if (block.type === "text") {
            fullResponse += block.text;
            send({ type: "text", content: block.text });
          } else if (block.type === "tool_use" && block.name === "run_sql") {
            const input = block.input as { sql: string; description: string };
            const sql = input.sql;
            const description = input.description;

            if (DANGEROUS_PATTERNS.test(sql)) {
              send({ type: "error", message: "DDL statements are not allowed." });
              continue;
            }

            if (isWriteQuery(sql)) {
              // Don't execute — send for confirmation
              send({ type: "pending_write", sql, description });
              toolCallData = {
                type: "sql_write",
                sql,
                description,
              };

              // Save a placeholder assistant message noting the pending write
              const pendingMsg = `I'd like to execute the following change:\n\n**${description}**\n\n\`\`\`sql\n${sql}\n\`\`\`\n\nPlease confirm or reject this operation.`;
              fullResponse = pendingMsg;
            } else {
              // Execute read query
              send({ type: "tool_use", sql, description, isWrite: false });
              const result = await executeSQL(sql);

              if (result.error) {
                send({ type: "error", message: result.error });
                toolCallData = {
                  type: "sql_read",
                  sql,
                  description,
                  error: result.error,
                };

                // Re-call Claude with the error so it can explain
                const followUp = await anthropic.messages.create({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 2048,
                  system: systemPrompt,
                  messages: [
                    ...claudeMessages,
                    {
                      role: "assistant",
                      content: [block],
                    },
                    {
                      role: "user",
                      content: [
                        {
                          type: "tool_result",
                          tool_use_id: block.id,
                          content: `Error: ${result.error}`,
                        },
                      ],
                    },
                  ],
                });

                for (const fb of followUp.content) {
                  if (fb.type === "text") {
                    fullResponse += fb.text;
                    send({ type: "text", content: fb.text });
                  }
                }
              } else {
                send({ type: "tool_result", result: result.data });
                toolCallData = {
                  type: "sql_read",
                  sql,
                  description,
                  result: result.data,
                };

                // Feed result back to Claude for summarization
                const followUp = await anthropic.messages.create({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 2048,
                  system: systemPrompt,
                  messages: [
                    ...claudeMessages,
                    {
                      role: "assistant",
                      content: [block],
                    },
                    {
                      role: "user",
                      content: [
                        {
                          type: "tool_result",
                          tool_use_id: block.id,
                          content: JSON.stringify(result.data),
                        },
                      ],
                    },
                  ],
                });

                for (const fb of followUp.content) {
                  if (fb.type === "text") {
                    fullResponse += fb.text;
                    send({ type: "text", content: fb.text });
                  }
                }
              }
            }
          }
        }

        // Save assistant message
        const assistantMsgId = await saveMessage(
          sessionId,
          "assistant",
          fullResponse,
          toolCallData
        );

        // Update session timestamp
        await sb
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", sessionId);

        send({ type: "done", assistantMessageId: assistantMsgId });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
