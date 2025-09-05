"use client";

import { useEffect, useMemo, useState } from "react";
import { impliedProbAmerican, devigTwoWay, eloDelta } from "./lib";

type Game = {
  id: string;
  home: string;
  away: string;
  homeAmerican?: number;
  awayAmerican?: number;
};

type ApiGame = {
  id: string;
  completed: boolean;
  status: string;
  home: { abbr: string; score: number };
  away: { abbr: string; score: number };
};

const P0 = 20;
const K = 30;

const CURRENT_YEAR = new Date().getFullYear();
// sensible defaults: Regular season (2), Week 1
const DEFAULT_SEASON_TYPE = 2;
const DEFAULT_WEEK = 1;

export default function Home() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [week, setWeek] = useState<number>(DEFAULT_WEEK);
  const [seasontype, setSeasontype] = useState<number>(DEFAULT_SEASON_TYPE);

  const [board, setBoard] = useState<ApiGame[]>([]);
  const [slate, setSlate] = useState<Game[]>([]);
  const [picks, setPicks] = useState<Record<string, "home" | "away" | null>>({});
  const [results, setResults] = useState<Record<string, "home" | "away" | null>>({});
  const [locked, setLocked] = useState(false);

  // range for weeks shown in selector (pre 3, reg 18, post ~5)
  const maxWeeks = useMemo(() => {
    if (seasontype === 1) return 3;
    if (seasontype === 3) return 5;
    return 18;
  }, [seasontype]);

  useEffect(() => {
  const load = async () => {
    try {
      // 1) Weekly scoreboard
      const params = new URLSearchParams({
        year: String(year),
        week: String(week),
        seasontype: String(seasontype),
      });
      const r = await fetch(`/api/scoreboard/nfl?${params.toString()}`, { cache: "no-store" });
      const d = await r.json();
      const g: ApiGame[] = d?.games ?? [];
      setBoard(g);

      // 2) Convert to slate (all week’s games)
      let liveSlate: Game[] = g.map((x) => ({
        id: x.id,
        home: x.home.abbr,
        away: x.away.abbr,
        homeAmerican: -110,
        awayAmerican: -110,
      }));

      // 3) Fetch odds & merge
      const ro = await fetch(`/api/odds/nfl`, { cache: "no-store" });
      if (ro.ok) {
        const { odds } = (await ro.json()) as {
          odds?: Record<string, { homeAmerican: number; awayAmerican: number }>;
        };
        if (odds) {
          liveSlate = liveSlate.map((gm) => {
            const key = `${gm.away}@${gm.home}`;
            const o = odds[key];
            return o ? { ...gm, homeAmerican: o.homeAmerican, awayAmerican: o.awayAmerican } : gm;
          });
        }
      }

      setSlate(liveSlate);
      setLocked(false);
      setResults({});
      setPicks(Object.fromEntries(liveSlate.map((gm) => [gm.id, null])));
    } catch {
      setBoard([]);
      setSlate([]);
      setLocked(false);
      setResults({});
      setPicks({});
    }
  };
  load();
}, [year, week, seasontype]);


  const calc = (g: Game) => {
    const h = g.homeAmerican ?? -110;
    const a = g.awayAmerican ?? -110;
    const pHomeRaw = impliedProbAmerican(h);
    const pAwayRaw = impliedProbAmerican(a);
    const { pHome, pAway } = devigTwoWay(pHomeRaw, pAwayRaw);
    return { pHome, pAway };
  };

  const rightWrong = (p: number) => ({ right: Math.round(P0 * (1 - p)), wrong: -Math.round(P0 * p) });
  const lockPicks = () => setLocked(true);

  const settle = async () => {
    if (slate.length === 0) {
      alert("No games for this week.");
      return;
    }
    const payload = {
      year,
      week,
      seasontype,
      slate: slate.map(g => ({ id: g.id, home: g.home, away: g.away })),
    };
    const res = await fetch("/api/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      alert("Settle failed: " + (data?.error ?? "unknown"));
      return;
    }

    const finished: Record<string, "home" | "away"> = {};
    for (const [id, v] of Object.entries<string>(data.results ?? {})) {
      if (v === "home" || v === "away") finished[id] = v;
    }
    if (Object.keys(finished).length === 0) {
      alert("No FINAL games yet for this week.");
      return;
    }
    setResults(prev => ({ ...prev, ...finished }));
  };

  let totalDisplay = 0, totalElo = 0;
  slate.forEach(g => {
    const pick = picks[g.id]; if (!pick) return;
    const { pHome, pAway } = calc(g);
    const p = pick === "home" ? pHome : pAway;
    const res = results[g.id]; if (!locked || !res) return;
    const S = res === pick ? 1 : 0;
    totalDisplay += Math.round(P0 * (S - p));
    totalElo += eloDelta(K, S as 0 | 1, p);
  });

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 12 }}>
        RightCall — NFL Week Slate
      </h1>

      {/* Week controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label>Year</label>
        <input
          type="number"
          min={2005}
          max={year + 1}
          value={year}
          onChange={(e) => setYear(Number(e.currentTarget.value))}
          style={{ width: 90, background: "#111", color: "#fff", borderRadius: 6, padding: "6px 8px", border: "1px solid #444" }}
        />

        <label>Season</label>
        <select
          value={seasontype}
          onChange={(e) => { setSeasontype(Number(e.currentTarget.value)); setWeek(1); }}
          style={{ background: "#111", color: "#fff", borderRadius: 6, padding: "6px 8px", border: "1px solid #444" }}
        >
          <option value={1}>Preseason</option>
          <option value={2}>Regular</option>
          <option value={3}>Postseason</option>
        </select>

        <label>Week</label>
        <select
          value={week}
          onChange={(e) => setWeek(Number(e.currentTarget.value))}
          style={{ background: "#111", color: "#fff", borderRadius: 6, padding: "6px 8px", border: "1px solid #444" }}
        >
          {Array.from({ length: maxWeeks }, (_, i) => i + 1).map(w => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
      </div>

      {/* Slate (all games that week) */}
      {slate.length === 0 && <div style={{ marginBottom: 12, fontSize: 14, opacity: 0.8 }}>No games found.</div>}

      {slate.map(g => {
        const { pHome, pAway } = calc(g);
        const homeRW = rightWrong(pHome);
        const awayRW = rightWrong(pAway);
        const userPick = picks[g.id];

        return (
          <div key={g.id} style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {g.away} @ {g.home}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                disabled={locked}
                onClick={() => setPicks(prev => ({ ...prev, [g.id]: "home" }))}
                style={{
                  border: "1px solid #555", borderRadius: 8, padding: 10,
                  textAlign: "left", background: userPick === "home" ? "#111" : "#fff",
                  color: userPick === "home" ? "#fff" : "#111"
                }}
              >
                <div style={{ fontSize: 12 }}>Pick {g.home}</div>
                <div style={{ fontSize: 12, opacity: .7 }}>Win% {Math.round(pHome * 100)}%</div>
                <div style={{ fontSize: 13 }}>Right: +{homeRW.right} · Wrong: {homeRW.wrong}</div>
              </button>

              <button
                disabled={locked}
                onClick={() => setPicks(prev => ({ ...prev, [g.id]: "away" }))}
                style={{
                  border: "1px solid #555", borderRadius: 8, padding: 10,
                  textAlign: "left", background: userPick === "away" ? "#111" : "#fff",
                  color: userPick === "away" ? "#fff" : "#111"
                }}
              >
                <div style={{ fontSize: 12 }}>Pick {g.away}</div>
                <div style={{ fontSize: 12, opacity: .7 }}>Win% {Math.round(pAway * 100)}%</div>
                <div style={{ fontSize: 13 }}>Right: +{awayRW.right} · Wrong: {awayRW.wrong}</div>
              </button>
            </div>

            {locked && results[g.id] && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                Result: <b>{results[g.id]}</b> won · Your pick: <b>{picks[g.id] ?? "-"}</b>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={lockPicks} disabled={locked || slate.length === 0}
          style={{ padding: "8px 12px", border: "1px solid #555", borderRadius: 8 }}>
          {locked ? "Locked" : "Lock my picks"}
        </button>
        <button onClick={settle} disabled={!locked}
          style={{ padding: "8px 12px", border: "1px solid #555", borderRadius: 8 }}>
          Settle
        </button>
      </div>

      {/* Simple scoreboard */}
      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>
          Scoreboard — {year} · {seasontype === 1 ? "Pre" : seasontype === 2 ? "Regular" : "Post"} Week {week}
        </h3>
        {board.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>No games.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14 }}>
            {board.map(g => (
              <li key={g.id} style={{ marginBottom: 4 }}>
                {g.away.abbr} {g.away.score} @ {g.home.abbr} {g.home.score} · {g.completed ? "FINAL" : g.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Summary */}
      {locked && Object.keys(results).length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "#0f0f0f", border: "1px solid #222", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
          <div>Display points total: <b>{totalDisplay >= 0 ? `+${totalDisplay}` : totalDisplay}</b></div>
          <div>
            Elo change (K=30):{" "}
            <b>{(Math.round(totalElo * 1000) / 1000 >= 0 ? "+" : "") + (Math.round(totalElo * 1000) / 1000)}</b>
          </div>
        </div>
      )}
    </main>
  );
}
