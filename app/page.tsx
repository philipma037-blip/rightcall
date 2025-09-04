"use client";

import { useEffect, useState } from "react";
import { impliedProbAmerican, devigTwoWay, eloDelta } from "./lib";

type Game = { id: string; home: string; away: string; homeAmerican?: number; awayAmerican?: number };
type ApiGame = { id: string; completed: boolean; status: string; home: { abbr: string; score: number }; away: { abbr: string; score: number } };

const P0 = 20;
const K = 30;

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export default function Home() {
  const [date, setDate] = useState<string>(yyyymmdd());
  const [slate, setSlate] = useState<Game[]>([]);
  const [board, setBoard] = useState<ApiGame[]>([]);
  const [picks, setPicks] = useState<Record<string, "home" | "away" | null>>({});
  const [results, setResults] = useState<Record<string, "home" | "away" | null>>({});
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`/api/scoreboard/nfl?date=${date}`, { cache: "no-store" });
        const d = await r.json();
        const g: ApiGame[] = d?.games ?? [];
        setBoard(g);

        const notFinal = g.filter(x => !x.completed);
        const candidates = notFinal.length > 0 ? notFinal : g;

        const liveSlate: Game[] = candidates.slice(0, 3).map(x => ({
          id: x.id, home: x.home.abbr, away: x.away.abbr, homeAmerican: -110, awayAmerican: -110
        }));

        setSlate(liveSlate);
        setLocked(false);
        setResults({});
        setPicks(Object.fromEntries(liveSlate.map(gm => [gm.id, null])));
      } catch {
        setBoard([]); setSlate([]); setLocked(false); setResults({}); setPicks({});
      }
    };
    load();
  }, [date]);

  const calc = (g: Game) => {
    const h = g.homeAmerican ?? -110, a = g.awayAmerican ?? -110;
    const pHomeRaw = impliedProbAmerican(h);
    const pAwayRaw = impliedProbAmerican(a);
    const { pHome, pAway } = devigTwoWay(pHomeRaw, pAwayRaw);
    return { pHome, pAway };
  };

  const rightWrong = (p: number) => ({ right: Math.round(P0 * (1 - p)), wrong: -Math.round(P0 * p) });
  const lockPicks = () => setLocked(true);

  const settle = async () => {
    if (slate.length === 0) { alert("No games for this date."); return; }
    const payload = { date, slate: slate.map(g => ({ id: g.id, home: g.home, away: g.away })) };
    const res = await fetch("/api/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store" });
    const data = await res.json();
    if (!res.ok) { alert("Settle failed: " + (data?.error ?? "unknown")); return; }

    const finished: Record<string, "home" | "away"> = {};
    for (const [id, v] of Object.entries<string>(data.results ?? {})) if (v === "home" || v === "away") finished[id] = v;
    if (Object.keys(finished).length === 0) { alert("No FINAL games yet for this date."); return; }
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
    <main style={{ padding: 16, maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 12 }}>RightCall — Live Slate</h1>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 14, opacity: 0.9 }}>Date:</label>
        <input
          type="date"
          value={`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`}
          onChange={(e) => setDate(e.currentTarget.value.replaceAll("-", ""))}
          style={{ background: "#111", color: "#fff", borderRadius: 6, padding: "6px 8px", border: "1px solid #444" }}
        />
        <div style={{ fontSize: 12, opacity: 0.7 }}>(changes reload real matchups)</div>
      </div>

      {slate.length === 0 && <div style={{ marginBottom: 12, fontSize: 14, opacity: 0.8 }}>No games found for this date.</div>}

      {slate.map(g => {
        const { pHome, pAway } = calc(g);
        const homeRW = rightWrong(pHome);
        const awayRW = rightWrong(pAway);
        const userPick = picks[g.id];

        return (
          <div key={g.id} style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{g.away} @ {g.home}</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button disabled={locked} onClick={() => setPicks(prev => ({ ...prev, [g.id]: "home" }))}
                style={{ border: "1px solid #555", borderRadius: 8, padding: 10, textAlign: "left", background: userPick === "home" ? "#111" : "#fff", color: userPick === "home" ? "#fff" : "#111" }}>
                <div style={{ fontSize: 12 }}>Pick {g.home}</div>
                <div style={{ fontSize: 12, opacity: .7 }}>Win% {Math.round(pHome * 100)}%</div>
                <div style={{ fontSize: 13 }}>Right: +{homeRW.right} · Wrong: {homeRW.wrong}</div>
              </button>

              <button disabled={locked} onClick={() => setPicks(prev => ({ ...prev, [g.id]: "away" }))}
                style={{ border: "1px solid #555", borderRadius: 8, padding: 10, textAlign: "left", background: userPick === "away" ? "#111" : "#fff", color: userPick === "away" ? "#fff" : "#111" }}>
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

      {locked && Object.keys(results).length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "#0f0f0f", border: "1px solid #222", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
          <div>Display points total: <b>{totalDisplay >= 0 ? `+${totalDisplay}` : totalDisplay}</b></div>
          <div>Elo change (K=30): <b>{Math.round(totalElo * 1000) / 1000 >= 0 ? `+${Math.round(totalElo * 1000) / 1000}` : Math.round(totalElo * 1000) / 1000}</b></div>
        </div>
      )}

      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Scoreboard — {date}</h3>
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
    </main>
  );
}
