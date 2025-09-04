// app/api/scoreboard/nfl/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}${m}${day}`;
}

async function fetchEspnNFL(date?: string) {
  const base1 = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const base2 = "https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard";
  const qs = date ? `?dates=${date}` : "";
  const headers = { "User-Agent": "Mozilla/5.0 (RightCall MVP)" };

  let res = await fetch(`${base1}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) res = await fetch(`${base2}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) return { ok:false as const, status: res.status };

  const data = await res.json();
  const games = (data?.events ?? []).map((ev: any) => {
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find((t:any)=>t.homeAway==="home");
    const away = comp?.competitors?.find((t:any)=>t.homeAway==="away");
    return {
      id: ev.id,
      start: ev.date,
      status: comp?.status?.type?.name,
      completed: Boolean(comp?.status?.type?.completed),
      home: { abbr: home?.team?.abbreviation, name: home?.team?.displayName, score: Number(home?.score ?? 0) },
      away: { abbr: away?.team?.abbreviation, name: away?.team?.displayName, score: Number(away?.score ?? 0) },
    };
  });
  return { ok:true as const, games };
}

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") || yyyymmdd();
  const out = await fetchEspnNFL(date);
  if (!out.ok) return NextResponse.json({ error:`upstream status ${out.status}` }, { status:502 });
  return NextResponse.json({ date, games: out.games });
}
