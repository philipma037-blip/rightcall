"use client";
import { useState } from "react";
import { impliedProbAmerican, devigTwoWay, eloDelta } from "./lib";

type Game = {
  id: string;
  home: string;
  away: string;
  homeAmerican: number;
  awayAmerican: number;
};

const P0 = 20;   // display points scale
const K  = 30;   // Elo sensitivity

const SLATE: Game[] = [
  { id: "NFL-W01-NYJ-BUF", home: "BUF", away: "NYJ", homeAmerican: -160, awayAmerican: +140 },
  { id: "NFL-W01-DAL-PHI", home: "PHI", away: "DAL", homeAmerican: -115, awayAmerican: -105 },
  { id: "NFL-W01-KC-BAL",  home: "KC",  away: "BAL", homeAmerican: +110, awayAmerican: -130 },
];

export default function Home() {
  const [picks, setPicks] = useState<Record<string, "home" | "away" | null>>(
    Object.fromEntries(SLATE.map(g => [g.id, null]))
  );
  const [locked, setLocked] = useState(false);
  const [results, setResults] = useState<Record<string, "home" | "away" | null>>({});

  const calc = (g: Game) => {
    const pHomeRaw = impliedProbAmerican(g.homeAmerican);
    const pAwayRaw = impliedProbAmerican(g.awayAmerican);
    const { pHome, pAway } = devigTwoWay(pHomeRaw, pAwayRaw);
    return { pHome, pAway };
  };

  const rightWrong = (p: number) => ({
    right: Math.round(P0 * (1 - p)),
    wrong: -Math.round(P0 * p),
  });

  const lockPicks = () => setLocked(true);

  const settle = () => {
    // Demo: resolve winners randomly based on win% (real app will use real scores)
    const r: Record<string, "home" | "away"> = {};
    SLATE.forEach(g => {
      const { pHome } = calc(g);
      r[g.id] = Math.random() < pHome ? "home" : "away";
    });
    setResults(r);
  };

  let totalDisplay = 0;
  let totalElo = 0;

  SLATE.forEach(g => {
    const pick = picks[g.id];
    if (!pick) return;
    const { pHome, pAway } = calc(g);
    const p = pick === "home" ? pHome : pAway;
    const res = results[g.id];
    if (!locked || !res) return;
    const S = res === pick ? 1 : 0;
    totalDisplay += Math.round(P0 * (S - p));
    totalElo += eloDelta(K, S as 0|1, p);
  });

  return (
    <main style={{padding:16, maxWidth:720, margin:"0 auto"}}>
      <h1 style={{fontWeight:700, fontSize:22, marginBottom:12}}>RightCall — Demo Slate</h1>

      {SLATE.map(g => {
        const { pHome, pAway } = calc(g);
        const homeRW = rightWrong(pHome);
        const awayRW = rightWrong(pAway);
        const userPick = picks[g.id];

        return (
          <div key={g.id} style={{border:"1px solid #ddd", borderRadius:8, padding:12, marginBottom:10}}>
            <div style={{fontWeight:600, marginBottom:8}}>{g.away} @ {g.home}</div>

            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
              <button
                disabled={locked}
                onClick={() => setPicks(prev => ({ ...prev, [g.id]: "home" }))}
                style={{border:"1px solid #aaa", borderRadius:8, padding:10, textAlign:"left", background:userPick==="home"?"#111":"#fff", color:userPick==="home"?"#fff":"#111"}}
              >
                <div style={{fontSize:12}}>Pick {g.home}</div>
                <div style={{fontSize:12, opacity:.7}}>Win% {Math.round(pHome*100)}%</div>
                <div style={{fontSize:13}}>Right: +{homeRW.right} · Wrong: {homeRW.wrong}</div>
              </button>

              <button
                disabled={locked}
                onClick={() => setPicks(prev => ({ ...prev, [g.id]: "away" }))}
                style={{border:"1px solid #aaa", borderRadius:8, padding:10, textAlign:"left", background:userPick==="away"?"#111":"#fff", color:userPick==="away"?"#fff":"#111"}}
              >
                <div style={{fontSize:12}}>Pick {g.away}</div>
                <div style={{fontSize:12, opacity:.7}}>Win% {Math.round(pAway*100)}%</div>
                <div style={{fontSize:13}}>Right: +{awayRW.right} · Wrong: {awayRW.wrong}</div>
              </button>
            </div>

            {locked && results[g.id] && (
              <div style={{marginTop:8, fontSize:13}}>
                Result: <b>{results[g.id]}</b> won · Your pick: <b>{picks[g.id] ?? "-"}</b>
              </div>
            )}
          </div>
        );
      })}

      <div style={{display:"flex", gap:8, marginTop:12}}>
        <button onClick={lockPicks} disabled={locked} style={{padding:"8px 12px", border:"1px solid #aaa", borderRadius:8}}>
          {locked ? "Locked" : "Lock my picks"}
        </button>
        <button onClick={settle} disabled={!locked} style={{padding:"8px 12px", border:"1px solid #aaa", borderRadius:8}}>
          Settle (demo)
        </button>
      </div>

      {locked && Object.keys(results).length === SLATE.length && (
        <div style={{marginTop:16, padding:12, background:"#f8f8f8", border:"1px solid #eee", borderRadius:8}}>
          <div style={{fontWeight:600, marginBottom:4}}>Summary</div>
          <div>Display points total: <b>{totalDisplay >= 0 ? `+${totalDisplay}` : totalDisplay}</b></div>
          <div>Elo change (K=30): <b>{totalElo >= 0 ? `+${totalElo}` : totalElo}</b></div>
        </div>
      )}
    </main>
  );
}
