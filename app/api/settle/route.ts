// app/api/settle/route.ts
import { NextResponse } from "next/server";

type SlateGame = { id: string; home: string; away: string };

type BoardTeam = { abbr: string; score: number };
type BoardGame = {
  id: string;
  completed: boolean;
  home: BoardTeam;
  away: BoardTeam;
};

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchEspnNFL(date?: string): Promise<BoardGame[]> {
  const base1 = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const base2 = "https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard";
  const qs = `?dates=${date || yyyymmdd()}`;
  const headers = { "User-Agent": "Mozilla/5.0 (RightCall MVP)" };

  let res = await fetch(`${base1}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) res = await fetch(`${base2}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`scoreboard fetch failed: ${res.status}`);

  const data = await res.json();
  const events: any[] = data?.events ?? [];

  return events.map((ev: any): BoardGame => {
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find((t: any) => t.homeAway === "home");
    const away = comp?.competitors?.find((t: any) => t.homeAway === "away");
    return {
      id: String(ev.id),
      completed: Boolean(comp?.status?.type?.completed),
      home: { abbr: String(home?.team?.abbreviation ?? ""), score: Number(home?.score ?? 0) },
      away: { abbr: String(away?.team?.abbreviation ?? ""), score: Number(away?.score ?? 0) },
    };
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { date?: string; slate?: SlateGame[] };
    const slateArr: SlateGame[] = Array.isArray(body.slate) ? body.slate : [];
    if (slateArr.length === 0) {
      return NextResponse.json({ error: "missing slate[]" }, { status: 400 });
    }

    const board: BoardGame[] = await fetchEspnNFL(body.date);
    const results: Record<string, "home" | "away" | "pending" | "missing"> = {};

    for (const g of slateArr) {
      const m = board.find(
        (b: BoardGame) => b.home.abbr === g.home && b.away.abbr === g.away
      );
      if (!m) { results[g.id] = "missing"; continue; }
      if (!m.completed) { results[g.id] = "pending"; continue; }
      results[g.id] = m.home.score > m.away.score ? "home" : "away";
    }

    return NextResponse.json({ date: body.date || yyyymmdd(), results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
