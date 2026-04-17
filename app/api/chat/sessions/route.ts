import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/** GET /api/chat/sessions?userId=xxx — list sessions for a user */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin;
  if (!sb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data, error } = await sb
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/** POST /api/chat/sessions — create a new session */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, userId, title } = body;

  if (!id || !userId) {
    return NextResponse.json({ error: "id and userId are required" }, { status: 400 });
  }

  const sb = supabaseAdmin;
  if (!sb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { data, error } = await sb
    .from("chat_sessions")
    .insert({
      id,
      user_id: userId,
      title: title || "New conversation",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
