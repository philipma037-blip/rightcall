import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** ---- Minimal ESPN shapes (only the fields we read) ---- */
type EspnTeam = { abbreviation?: string; displayName?: string };
type EspnCompetitor = { homeAway?: "home" | "away"; team?: EspnTeam; score?: string | number };
type EspnStatusType = { name?: string; completed?: boolean };
type EspnStatus = { type?: EspnStatusType };
type EspnCompetition = { competitors?: EspnCompetitor[]; status?: EspnStatus };
type EspnEvent = { id?: string | number; date?: string; competitions?: EspnCompetition[] };
type EspnResponse = { events?: EspnEvent[] };

/** ---- Output shapes for our API ---- */
type OutTeam = { abbr: string; name: string; score: number };
type OutGame = {
  id: string;
  start: string;
  status: string;
  completed: boolean;
  home: OutTeam;
  away: OutTeam;
};

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchEspnNFL(date?: string): Promise<OutGame[] | { ok: false; status: number }> {
  const base1 = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const base2 = "https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard";
  const qs = date ? `?dates=${date}` : "";
  const headers = { "User-Agent": "Mozilla/5.0 (RightCall MVP)" };

  let res = await fetch(`${base1}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) res = await fetch(`${base2}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) return { ok: false as const, status: res.status };

  const data = (await res.json()) as Partial<EspnResponse>;
  const events: EspnEvent[] = Array.isArray(data.events) ? data.events : [];

  const games: OutGame[] = events.map((ev) => {
    const comp: EspnCompetition | undefined = ev?.competitions?.[0];
    const home = comp?.competitors?.find((t) => t.homeAway === "home");
    const away = comp?.competitors?.find((t) => t.homeAway === "away");
    return {
      id: String(ev?.id ?? ""),
      start: String(ev?.date ?? ""),
      status: comp?.status?.type?.name ?? "",
      completed: Boolean(comp?.status?.type?.completed),
      home: {
        abbr: home?.team?.abbreviation ?? "",
        name: home?.team?.displayName ?? "",
        score: toNumber(home?.score),
      },
      away: {
        abbr: away?.team?.abbreviation ?? "",
        name: away?.team?.displayName ?? "",
        score: toNumber(away?.score),
      },
    };
  });

  return games;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || yyyymmdd();
  const out = await fetchEspnNFL(date);

  if (Array.isArray(out)) {
    return NextResponse.json({ date, games: out });
  }
  return NextResponse.json({ error: `upstream status ${out.status}` }, { status: 502 });
}
