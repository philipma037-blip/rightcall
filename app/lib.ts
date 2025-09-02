export function impliedProbAmerican(a: number) {
  return a >= 0 ? 100 / (a + 100) : (-a) / (-a + 100);
}
export function devigTwoWay(pHomeRaw: number, pAwayRaw: number) {
  const sum = pHomeRaw + pAwayRaw;
  return { pHome: pHomeRaw / sum, pAway: pAwayRaw / sum };
}
export function eloDelta(K: number, S: 0 | 1, p: number, pickCap = 40) {
  const raw = K * (S - p);
  const capped = Math.max(-pickCap, Math.min(pickCap, raw));
  return Math.round(capped);
}
