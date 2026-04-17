import { supabaseAdmin } from "@/lib/supabase";

let cachedSchema: string | null = null;

/**
 * Queries information_schema via exec_sql to build a human-readable description
 * of all application tables and their columns. Result is cached after first call.
 */
export async function getDatabaseSchema(): Promise<string> {
  if (cachedSchema) return cachedSchema;

  const sb = supabaseAdmin;
  if (!sb) return "(database schema unavailable — Supabase not configured)";

  try {
    const { data, error } = await sb.rpc("exec_sql", {
      query: `
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name NOT IN ('chat_sessions', 'chat_messages')
        ORDER BY table_name, ordinal_position
      `,
    });

    if (error || !data) {
      return "(could not read database schema)";
    }

    const columns = data as Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;

    const tables = new Map<string, string[]>();
    for (const col of columns) {
      if (!tables.has(col.table_name)) tables.set(col.table_name, []);
      const nullable = col.is_nullable === "YES" ? " (nullable)" : "";
      const def = col.column_default ? ` default=${col.column_default}` : "";
      tables
        .get(col.table_name)!
        .push(`  - ${col.column_name}: ${col.data_type}${nullable}${def}`);
    }

    const lines: string[] = [];
    for (const [table, cols] of tables) {
      lines.push(`Table: ${table}`);
      lines.push(cols.join("\n"));
      lines.push("");
    }

    cachedSchema = lines.join("\n");
    return cachedSchema;
  } catch {
    return "(could not read database schema)";
  }
}

/** Force-refresh the cached schema (e.g. after migrations) */
export function clearSchemaCache(): void {
  cachedSchema = null;
}
