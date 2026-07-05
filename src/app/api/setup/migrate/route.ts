import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { SCHEMA_STATEMENTS } from "@/lib/schemaSql";

// One-off setup endpoint: applies the schema (see src/lib/schemaSql.ts).
// Safe to call multiple times (every statement is CREATE ... IF NOT EXISTS).
// Protected by the same secret as the cron endpoint so it can't be
// triggered by randoms.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await sql.query(statement);
    }
    return NextResponse.json({ ok: true, statementsApplied: SCHEMA_STATEMENTS.length });
  } catch (err: any) {
    console.error("[setup/migrate] failed:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
