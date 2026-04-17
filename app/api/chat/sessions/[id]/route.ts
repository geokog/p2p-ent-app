import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

interface Params {
  params: Promise<{ id: string }>;
}

/** GET /api/chat/sessions/[id] — get session with messages */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const sb = supabaseAdmin;
  if (!sb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const [sessionRes, messagesRes] = await Promise.all([
    sb.from("chat_sessions").select("*").eq("id", id).single(),
    sb
      .from("chat_messages")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (sessionRes.error) {
    return NextResponse.json({ error: sessionRes.error.message }, { status: 404 });
  }

  return NextResponse.json({
    session: sessionRes.data,
    messages: messagesRes.data || [],
  });
}

/** PATCH /api/chat/sessions/[id] — rename session */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const sb = supabaseAdmin;
  if (!sb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data, error } = await sb
    .from("chat_sessions")
    .update({ title: body.title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/** DELETE /api/chat/sessions/[id] — delete session (cascades to messages) */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const sb = supabaseAdmin;
  if (!sb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { error } = await sb.from("chat_sessions").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
