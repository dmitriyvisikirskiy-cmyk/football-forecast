import { NextRequest, NextResponse } from "next/server";
import { runFullUpdate } from "@/aggregation/aggregate";

// Vercel Cron (configured in vercel.json) hits this once a day. It also
// authenticates itself with a Bearer token equal to CRON_SECRET, so we
// reject any other caller.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runFullUpdate();
    return NextResponse.json({ ok: true, summary });
  } catch (err: any) {
    console.error("[cron/update] failed:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
