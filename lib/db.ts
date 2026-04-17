/**
 * Data access layer — all reads and writes go through Supabase.
 *
 * CUSTOMIZE: Rename table names in the .from() calls to match your Supabase schema.
 * Each fetcher maps 1-to-1 with a database table.
 */

import { supabase } from "./supabase";
import type {
  Request,
  User,
  Document,
  Comment,
  AuditEvent,
  Notification,
  Rule,
} from "./types";

/** Throws if Supabase client is not configured. */
function sb() {
  if (!supabase)
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  return supabase;
}

// ── Full-table fetchers ────────────────────────────────────────

export async function getAllRequests(): Promise<Request[]> {
  const { data, error } = await sb().from("requests").select("*");
  if (error) throw error;
  return data as Request[];
}

export async function getAllUsers(): Promise<User[]> {
  const { data, error } = await sb().from("users").select("*");
  if (error) throw error;
  return data as User[];
}

export async function getAllDocuments(): Promise<Document[]> {
  const { data, error } = await sb().from("documents").select("*");
  if (error) throw error;
  return data as Document[];
}

export async function getAllComments(): Promise<Comment[]> {
  const { data, error } = await sb().from("comments").select("*");
  if (error) throw error;
  return data as Comment[];
}

export async function getAllAuditEvents(): Promise<AuditEvent[]> {
  const { data, error } = await sb().from("audit_events").select("*");
  if (error) throw error;
  return data as AuditEvent[];
}

export async function getAllNotifications(): Promise<Notification[]> {
  const { data, error } = await sb().from("notifications").select("*");
  if (error) throw error;
  return data as Notification[];
}

export async function getAllRules(): Promise<Rule[]> {
  const { data, error } = await sb().from("rules").select("*");
  if (error) throw error;
  return data as Rule[];
}

// ── Single-record fetchers ─────────────────────────────────────
// CUSTOMIZE: Rename "requests" to your entity table name.

export async function getRequestById(id: string): Promise<Request | undefined> {
  const { data, error } = await sb()
    .from("requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return undefined;
  return data as Request;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const { data, error } = await sb()
    .from("users")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return undefined;
  return data as User;
}

export async function getRuleById(id: string): Promise<Rule | undefined> {
  const { data, error } = await sb()
    .from("rules")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return undefined;
  return data as Rule;
}

// ── Relational fetchers ────────────────────────────────────────
// CUSTOMIZE: Adjust foreign-key column names to match your schema.

export async function getDocumentsForRequest(requestId: string): Promise<Document[]> {
  const { data, error } = await sb()
    .from("documents")
    .select("*")
    .eq("request_id", requestId);
  if (error) throw error;
  return data as Document[];
}

export async function getCommentsForRequest(requestId: string): Promise<Comment[]> {
  const { data, error } = await sb()
    .from("comments")
    .select("*")
    .eq("request_id", requestId);
  if (error) throw error;
  return data as Comment[];
}

export async function getAuditEventsForRequest(requestId: string): Promise<AuditEvent[]> {
  const { data, error } = await sb()
    .from("audit_events")
    .select("*")
    .eq("request_id", requestId);
  if (error) throw error;
  return data as AuditEvent[];
}

export async function getNotificationsForUser(userId: string): Promise<Notification[]> {
  const { data, error } = await sb()
    .from("notifications")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  return data as Notification[];
}

// ── Write functions ────────────────────────────────────────────
// CUSTOMIZE: Rename "requests" to your entity table name.

export async function insertRequest(entity: Omit<Request, "created_at" | "updated_at">): Promise<Request> {
  const { data, error } = await sb().from("requests").insert(entity).select().single();
  if (error) throw error;
  return data as Request;
}

export async function updateRequest(id: string, updates: Partial<Request>): Promise<Request> {
  const { data, error } = await sb()
    .from("requests")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Request;
}

export async function insertAuditEvent(event: Omit<AuditEvent, "created_at">): Promise<AuditEvent> {
  const { data, error } = await sb().from("audit_events").insert(event).select().single();
  if (error) throw error;
  return data as AuditEvent;
}

export async function insertComment(comment: Omit<Comment, "created_at">): Promise<Comment> {
  const { data, error } = await sb().from("comments").insert(comment).select().single();
  if (error) throw error;
  return data as Comment;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await sb()
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id);
  if (error) throw error;
}
