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

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function qsForWeek(year: number, week: number, seasontype: number) {
  const p = new URLSearchParams();
  p.set("year", String(year));
  p.set("week", String(week));
  p.set("seasontype", String(seasontype)); // 1=pre, 2=reg, 3=post
  return `?${p.toString()}`;
}

/** Fetch scoreboard by week (preferred) */
async function fetchEspnNFLByWeek(
  year: number,
  week: number,
  seasontype: number
): Promise<OutGame[] | { ok: false; status: number }> {
  const base1 = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const base2 = "https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard";
  const qs = qsForWeek(year, week, seasontype);
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
  const year = Number(url.searchParams.get("year") ?? new Date().getFullYear());
  const week = Number(url.searchParams.get("week") ?? 1);
  const seasontype = Number(url.searchParams.get("seasontype") ?? 2); // 2 = Regular

  const out = await fetchEspnNFLByWeek(year, week, seasontype);
  if (Array.isArray(out)) {
    return NextResponse.json({ year, week, seasontype, games: out });
  }
  return NextResponse.json({ error: `upstream status ${out.status}` }, { status: 502 });
}
