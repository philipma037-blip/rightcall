// app/api/supa/status/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, key);

  // simple count-only query (works with RLS)
  const { error, count } = await supabase
    .from("players")
    .select("*", { count: "exact", head: true });

  return NextResponse.json({ ok: !error, error: error?.message ?? null, count: count ?? 0 });
}
