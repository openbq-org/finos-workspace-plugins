const REFERENCE_ROUND_MS = 45;

export const MAX_PACE = 10;

export const paceOf = (roundMs: number): number =>
  Math.min(MAX_PACE, Math.max(1, roundMs / REFERENCE_ROUND_MS));

const ROUNDS = 3;

export function cpuNow(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

function round(): number {
  const seen = new Map<string, number>();
  const numbers = new Float64Array(40_000);
  const rows: { key: string; at: number }[] = [];
  let total = 0;
  for (let at = 0; at < 120_000; at++) {
    const key = `Row ${at % 4000} of ${at}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const short = key.slice(0, 9);
    seen.set(short, (seen.get(short) ?? 0) + 1);
    numbers[at % numbers.length] += Math.sqrt(at) * 1.5;
    if (at % 6 === 0) rows.push({ key, at: (at * 7919) % 10_007 });
    total += key.length;
  }
  rows.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
  for (const value of numbers) total += value > 1 ? 1 : 0;
  return total + seen.size + rows.length;
}

function pace(now: () => number): number {
  round();
  let slowest = 0;
  for (let at = 0; at < ROUNDS; at++) {
    const started = now();
    round();
    slowest = Math.max(slowest, now() - started);
  }
  return paceOf(slowest);
}

let cpuPace: number | undefined;

export function cpuBudget(ms: number): number {
  cpuPace ??= pace(cpuNow);
  return ms * cpuPace;
}

export function wallBudget(ms: number): number {
  return ms * pace(() => performance.now());
}
