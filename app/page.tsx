"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { impliedProbAmerican, devigTwoWay, eloDelta } from "./lib";

/** ---------- Types ---------- */
type Game = {
  id: string;
  home: string;
  away: string;
  homeAmerican: number;
  awayAmerican: number;
};

type PlayerRow = {
  id: string;
  user_id: string;
  display_name: string | null;
  elo: number;
  created_at?: string;
};

type SettleResults = Record< string, "home" | "away" | "pending" | "missing">;

type SettleOk = { date: string; results: SettleResults };
type SettleErr = { error: string };

type ScoreboardGame = {
  id: string;
  completed: boolean;
  status?: string;
  home: { abbr: string; score: number };
  away: { abbr: string; score: number };
};

type ScoreboardOk = { games: ScoreboardGame[] };
type ScoreboardErr = { error: string };

/** ---------- Constants ---------- */
const P0 = 20; // Display points scale
const K = 30;  // Elo sensitivity

/** Demo slate (can be replaced by weekly slate later) */
const SLATE: Game[] = [
  { id: "NFL-W01-NYJ-BUF", home: "BUF", away: "NYJ", homeAmerican: -160, awayAmerican: +140 },
  { id: "NFL-W01-DAL-PHI", home: "PHI", away: "DAL", homeAmerican: -115, awayAmerican: -105 },
  { id: "NFL-W01-KC-BAL",  home: "KC",  away: "BAL", homeAmerican: +110, awayAmerican: -130 },
];

/** ---------- Supabase helpers ---------- */
async function getSessionUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

async function ensurePlayer(displayName?: string): Promise<PlayerRow> {
  const user = await getSessionUser();
  if (!user) throw new Error("No session");

  const { data: rows, error } = await supabase
    .from("players")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);

  if (error) throw error;
  if (rows && rows.length > 0) return rows[0] as PlayerRow;

  const { data: inserted, error: insErr } = await supabase
    .from("players")
    .insert({ user_id: user.id, display_name: displayName ?? user.email })
    .select()
    .limit(1);

  if (insErr) throw insErr;
  return inserted![0] as PlayerRow;
}

/** ---------- UI Component ---------- */
export default function Home() {
  /** picks/results/UI state */
  const [picks, setPicks] = useState<Record<string, "home" | "away" | null>>(
    () => Object.fromEntries(SLATE.map((g) => [g.id, null]))
  );
  const [locked, setLocked] = useState(false);
  const [results, setResults] = useState<SettleResults>({});
  const [displayTotal, setDisplayTotal] = useState(0);
  const [eloTotal, setEloTotal] = useState(0);

  /** scoreboard (today) */
  const [board, setBoard] = useState<ScoreboardGame[]>([]);

  /** auth/player state */
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  /** handy map of per-game p and delta (computed after settle) */
  const [perGameProb, setPerGameProb] = useState<Record<string, number>>({});
  const [perGameDelta, setPerGameDelta] = useState<Record<string, number>>({});

  /** odds → probabilities (no-vig) for a game */
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

  /** ----- Auth boot ----- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user ?? null;
      setUserEmail(u?.email ?? null);
      if (u) {
        const p = await ensurePlayer();
        setPlayer(p);
      }

      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
        const curr = session?.user ?? null;
        setUserEmail(curr?.email ?? null);
        setPlayer(curr ? await ensurePlayer() : null);
      });
      return () => sub.subscription.unsubscribe();
    })();
  }, []);

  /** ----- Scoreboard boot ----- */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/scoreboard/nfl", { cache: "no-store" });
        const j = (await r.json()) as ScoreboardOk | ScoreboardErr;
        if ("games" in j && Array.isArray(j.games)) {
          setBoard(j.games);
        } else {
          setBoard([]);
        }
      } catch {
        setBoard([]);
      }
    })();
  }, []);

  /** lock picks */
  const lockPicks = () => setLocked(true);

  /** save slate to Supabase */
  async function saveSlateToCloud(args: {
    results: SettleResults;
    picks: Record<string, "home" | "away" | null>;
    probs: Record<string, number>;
    deltas: Record<string, number>;
    meta: { year: number; week: number; seasontype: number };
  }) {
    if (!player) {
      alert("Sign in to save your picks & Elo");
      return;
    }

    // rows for picks upsert
    const rows = Object.keys(args.results).map((gameId) => ({
      player_id: player.id,
      year: args.meta.year,
      week: args.meta.week,
      seasontype: args.meta.seasontype,
      game_id: gameId,
      pick: args.picks[gameId]!,
      result: args.results[gameId],
      prob: args.probs[gameId] ?? null,
      delta: args.deltas[gameId] ?? null,
    }));

    const { error: upErr } = await supabase
      .from("picks")
      .upsert(rows, { onConflict: "player_id,year,week,seasontype,game_id" });

    if (upErr) {
      // eslint-disable-next-line no-console
      console.error(upErr);
      alert("Failed to save picks");
      return;
    }

    // update Elo
    const slateDelta = Object.values(args.deltas).reduce((a, b) => a + (b || 0), 0);
    const { data: updated, error: eloErr } = await supabase
      .from("players")
      .update({ elo: (player.elo || 1200) + slateDelta })
      .eq("id", player.id)
      .select()
      .limit(1);

    if (eloErr) {
      // eslint-disable-next-line no-console
      console.error(eloErr);
      alert("Failed to update Elo");
      return;
    }
    const next = updated![0] as PlayerRow;
    setPlayer(next);
    alert(`Saved! Elo ${player.elo} → ${next.elo}`);
  }

  /** settle games via our API, compute deltas, save */
  const settle = async () => {
    // 1) call /api/settle with the slate
    const slate = SLATE.map((g) => ({ id: g.id, home: g.home, away: g.away }));
    const r = await fetch("/api/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slate }), // add { date: "YYYYMMDD" } if you want a specific date
      cache: "no-store",
    });
    const data = (await r.json()) as SettleOk | SettleErr;
    if (!r.ok || "error" in data) {
      alert("Settle failed: " + (("error" in data && data.error) || "unknown"));
      return;
    }

    // keep only finished results
    const finished: SettleResults = {};
    Object.entries(data.results).forEach(([k, v]) => {
      if (v === "home" || v === "away") finished[k] = v;
    });
    if (Object.keys(finished).length === 0) {
      alert("No matching games are FINAL yet.");
      return;
    }
    setResults(finished);

    // 2) compute totals & per-game probability/delta
    let totalDisplay = 0;
    let totalEloLocal = 0;
    const probs: Record<string, number> = {};
    const deltas: Record<string, number> = {};

    SLATE.forEach((g) => {
      const pick = picks[g.id];
      if (!pick) return;

      const { pHome, pAway } = calc(g);
      const p = pick === "home" ? pHome : pAway;
      probs[g.id] = p;

      const res = finished[g.id];
      if (!res) return;

      const S = (res === pick ? 1 : 0) as 0 | 1;
      const d = eloDelta(K, S, p);
      deltas[g.id] = d;

      totalDisplay += Math.round(P0 * (S - p));
      totalEloLocal += d;
    });

    setDisplayTotal(totalDisplay);
    setEloTotal(totalEloLocal);
    setPerGameProb(probs);
    setPerGameDelta(deltas);

    // 3) save to Supabase (example meta for season/week)
    await saveSlateToCloud({
      results: finished,
      picks,
      probs,
      deltas,
      meta: { year: new Date().getFullYear(), week: 1, seasontype: 2 }, // adjust as needed
    });
  };

  /** derived helpers */
  const allFinished = useMemo(
    () => Object.keys(results).length === SLATE.length,
    [results]
  );

  return (
    <main style={{ padding: 16, maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ fontWeight: 700, fontSize: 22, marginBottom: 12 }}>RightCall — Demo Slate</h1>

      {/* ---------- Auth bar ---------- */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "8px 0 16px" }}>
        {userEmail ? (
          <>
            <span>
              Signed in as <b>{userEmail}</b>
              {player ? ` · Elo ${player.elo}` : ""}
            </span>
            <button
              onClick={async () => { await supabase.auth.signOut(); }}
              style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 8 }}
            >
              Sign out
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get("email") as string;
              if (!email) return;
              setAuthLoading(true);
              const { error } = await supabase.auth.signInWithOtp({ email });
              setAuthLoading(false);
              if (error) alert(error.message);
              else alert("Check your email for the magic link!");
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 8 }}
            />
            <button
              disabled={authLoading}
              style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 8 }}
            >
              {authLoading ? "Sending…" : "Sign in"}
            </button>
          </form>
        )}
      </div>

      {/* ---------- Slate ---------- */}
      {SLATE.map((g) => {
        const { pHome, pAway } = calc(g);
        const homeRW = rightWrong(pHome);
        const awayRW = rightWrong(pAway);
        const userPick = picks[g.id];

        return (
          <div key={g.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {g.away} @ {g.home}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                disabled={locked}
                onClick={() => setPicks((prev) => ({ ...prev, [g.id]: "home" }))}
                style={{
                  border: "1px solid #aaa",
                  borderRadius: 8,
                  padding: 10,
                  textAlign: "left",
                  background: userPick === "home" ? "#111" : "#fff",
                  color: userPick === "home" ? "#fff" : "#111",
                }}
              >
                <div style={{ fontSize: 12 }}>Pick {g.home}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Win% {Math.round(pHome * 100)}%</div>
                <div style={{ fontSize: 13 }}>
                  Right: +{homeRW.right} · Wrong: {homeRW.wrong}
                </div>
              </button>

              <button
                disabled={locked}
                onClick={() => setPicks((prev) => ({ ...prev, [g.id]: "away" }))}
                style={{
                  border: "1px solid #aaa",
                  borderRadius: 8,
                  padding: 10,
                  textAlign: "left",
                  background: userPick === "away" ? "#111" : "#fff",
                  color: userPick === "away" ? "#fff" : "#111",
                }}
              >
                <div style={{ fontSize: 12 }}>Pick {g.away}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Win% {Math.round(pAway * 100)}%</div>
                <div style={{ fontSize: 13 }}>
                  Right: +{awayRW.right} · Wrong: {awayRW.wrong}
                </div>
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
        <button onClick={lockPicks} disabled={locked} style={{ padding: "8px 12px", border: "1px solid #aaa", borderRadius: 8 }}>
          {locked ? "Locked" : "Lock my picks"}
        </button>
        <button onClick={settle} disabled={!locked} style={{ padding: "8px 12px", border: "1px solid #aaa", borderRadius: 8 }}>
          Settle (demo)
        </button>
      </div>

      {locked && Object.keys(results).length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "#f8f8f8", border: "1px solid #eee", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Summary</div>
          <div>
            Display points total: <b>{displayTotal >= 0 ? `+${displayTotal}` : displayTotal}</b>
          </div>
          <div>
            Elo change (K=30): <b>{eloTotal >= 0 ? `+${eloTotal}` : eloTotal}</b>
          </div>
        </div>
      )}

      {/* ---------- Live/Today’s Scores ---------- */}
      <section className="mt-6" style={{ marginTop: 24 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Live/Today’s Scores</h3>
        <ul style={{ display: "grid", gap: 6, fontSize: 14, listStyle: "none", padding: 0 }}>
          {board.map((g) => (
            <li key={g.id}>
              {g.away.abbr} {g.away.score} @ {g.home.abbr} {g.home.score} · {g.completed ? "FINAL" : g.status || ""}
            </li>
          ))}
          {board.length === 0 && <li style={{ opacity: 0.7 }}>No games returned for today.</li>}
        </ul>
      </section>
    </main>
  );
}
