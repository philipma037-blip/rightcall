import { NextResponse } from "next/server";

type SlateGame = { id: string; home: string; away: string };

type BoardTeam = { abbr: string; score: number };
type BoardGame = { id: string; completed: boolean; home: BoardTeam; away: BoardTeam };

/** ESPN input types (minimal) */
type EspnTeam = { abbreviation?: string };
type EspnCompetitor = { homeAway?: "home" | "away"; team?: EspnTeam; score?: string | number };
type EspnStatusType = { completed?: boolean };
type EspnStatus = { type?: EspnStatusType };
type EspnCompetition = { competitors?: EspnCompetitor[]; status?: EspnStatus };
type EspnEvent = { id?: string | number; competitions?: EspnCompetition[] };
type EspnResponse = { events?: EspnEvent[] };

const toNumber = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function qsForWeek(year: number, week: number, seasontype: number) {
  const p = new URLSearchParams();
  p.set("year", String(year));
  p.set("week", String(week));
  p.set("seasontype", String(seasontype));
  return `?${p.toString()}`;
}

async function fetchEspnNFLByWeek(
  year: number,
  week: number,
  seasontype: number
): Promise<BoardGame[]> {
  const base1 = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const base2 = "https://site.api.espn.com/apis/v2/sports/football/nfl/scoreboard";
  const qs = qsForWeek(year, week, seasontype);
  const headers = { "User-Agent": "Mozilla/5.0 (RightCall MVP)" };

  let res = await fetch(`${base1}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) res = await fetch(`${base2}${qs}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`scoreboard fetch failed: ${res.status}`);

  const data = (await res.json()) as Partial<EspnResponse>;
  const events: EspnEvent[] = Array.isArray(data.events) ? data.events : [];

  return events.map((ev): BoardGame => {
    const comp: EspnCompetition | undefined = ev?.competitions?.[0];
    const home = comp?.competitors?.find((t) => t.homeAway === "home");
    const away = comp?.competitors?.find((t) => t.homeAway === "away");
    return {
      id: String(ev?.id ?? ""),
      completed: Boolean(comp?.status?.type?.completed),
      home: { abbr: home?.team?.abbreviation ?? "", score: toNumber(home?.score) },
      away: { abbr: away?.team?.abbreviation ?? "", score: toNumber(away?.score) },
    };
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      slate?: SlateGame[];
      year?: number;
      week?: number;
      seasontype?: number; // 1=pre, 2=reg, 3=post
    };

    const slateArr: SlateGame[] = Array.isArray(body.slate) ? body.slate : [];
    if (slateArr.length === 0) {
      return NextResponse.json({ error: "missing slate[]" }, { status: 400 });
    }

    const year = Number(body.year ?? new Date().getFullYear());
    const week = Number(body.week ?? 1);
    const seasontype = Number(body.seasontype ?? 2);

    const board = await fetchEspnNFLByWeek(year, week, seasontype);
    const results: Record<string, "home" | "away" | "pending" | "missing"> = {};

    for (const g of slateArr) {
      const m = board.find((b) => b.home.abbr === g.home && b.away.abbr === g.away);
      if (!m) { results[g.id] = "missing"; continue; }
      if (!m.completed) { results[g.id] = "pending"; continue; }
      results[g.id] = m.home.score > m.away.score ? "home" : "away";
    }

    return NextResponse.json({ year, week, seasontype, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
