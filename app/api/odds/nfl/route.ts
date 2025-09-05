// app/api/odds/nfl/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type OddsOutcome = { name?: string; price?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; markets?: OddsMarket[] };
type OddsEvent = {
  id?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: OddsBookmaker[];
};
type OddsResponse = OddsEvent[];

const TEAM_ABBR: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
  "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const arr = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

export async function GET() {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ODDS_API_KEY not set" }, { status: 500 });
  }

  const url = new URL("https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds");
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  url.searchParams.set("apiKey", key);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ error: `odds upstream ${res.status}` }, { status: 502 });
  }
  const data = (await res.json()) as OddsResponse;

  const out: Record<string, { homeAmerican: number; awayAmerican: number }> = {};

  for (const ev of data) {
    const homeName = ev.home_team ?? "";
    const awayName = ev.away_team ?? "";
    const home = TEAM_ABBR[homeName] ?? "";
    const away = TEAM_ABBR[awayName] ?? "";
    if (!home || !away) continue;

    const homePrices: number[] = [];
    const awayPrices: number[] = [];

    for (const bk of ev.bookmakers ?? []) {
      const m = (bk.markets ?? []).find((x) => x.key === "h2h");
      if (!m) continue;
      for (const o of m.outcomes ?? []) {
        const price = Number(o.price);
        if (!Number.isFinite(price)) continue;
        if (o.name === homeName) homePrices.push(price);
        if (o.name === awayName) awayPrices.push(price);
      }
    }

    if (homePrices.length === 0 || awayPrices.length === 0) continue;
    const homeAmerican = Math.round(median(homePrices));
    const awayAmerican = Math.round(median(awayPrices));
    out[`${away}@${home}`] = { homeAmerican, awayAmerican };
  }

  return NextResponse.json({ odds: out });
}
