/*
 * Forecasting in the browser: Holt's linear trend (double exponential smoothing). The smoothing
 * of the level and of the trend are chosen by the least squared one-step error over the history,
 * and the band is the forecast plus or minus 1.96 times that error's spread, widening with the
 * horizon. Nothing leaves the frame.
 */

export const MIN_POINTS = 4;
export const DEFAULT_PERIODS = 6;
export const MAX_PERIODS = 60;
const STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function fit(values, alpha, beta) {
  let level = values[0];
  let trend = values[1] - values[0];
  let squared = 0;
  for (let i = 1; i < values.length; i++) {
    const predicted = level + trend;
    squared += (values[i] - predicted) ** 2;
    const nextLevel = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
  }
  return { level, trend, squared };
}

/**
 * The forecast of `values` for `periods` steps: { forecast, lower, upper, alpha, beta, sigma },
 * or null with fewer than MIN_POINTS finite values.
 */
export function holt(values, periods = DEFAULT_PERIODS) {
  const series = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (series.length < MIN_POINTS) return null;
  let best = null;
  for (const alpha of STEPS)
    for (const beta of STEPS) {
      const result = fit(series, alpha, beta);
      if (!best || result.squared < best.squared) best = { ...result, alpha, beta };
    }
  const sigma = Math.sqrt(best.squared / Math.max(1, series.length - 2));
  const forecast = [];
  const lower = [];
  const upper = [];
  for (let h = 1; h <= periods; h++) {
    const value = best.level + h * best.trend;
    const spread = 1.96 * sigma * Math.sqrt(h);
    forecast.push(value);
    lower.push(value - spread);
    upper.push(value + spread);
  }
  return { forecast, lower, upper, alpha: best.alpha, beta: best.beta, sigma };
}

const DAY = 86_400_000;

function timeOf(x) {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) {
    const t = Date.parse(x.length === 10 ? `${x}T00:00:00Z` : x);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * The labels of the periods after `xs`: dates continue at the median step (as ISO dates, or by
 * months when the history is monthly or quarterly), numbers continue at their median step, and
 * anything else becomes +1, +2 and so on.
 */
export function nextLabels(xs, periods) {
  const times = xs.map(timeOf);
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  if (times.length > 1 && times.every((t) => t !== null)) {
    const steps = times.slice(1).map((t, i) => t - times[i]);
    const step = median(steps);
    const last = new Date(times.at(-1));
    const months = Math.round(step / (30.44 * DAY));
    const monthly = months >= 1 && Math.abs(step - months * 30.44 * DAY) < 4 * DAY;
    return Array.from({ length: periods }, (_, i) => {
      const next = monthly
        ? new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + months * (i + 1) + 1, 0))
        : new Date(times.at(-1) + step * (i + 1));
      return next.toISOString().slice(0, 10);
    });
  }
  if (xs.length > 1 && xs.every((x) => typeof x === "number" && Number.isFinite(x))) {
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    const step = median(steps) || 1;
    return Array.from({ length: periods }, (_, i) => xs.at(-1) + step * (i + 1));
  }
  return Array.from({ length: periods }, (_, i) => `+${i + 1}`);
}

/**
 * The chart data of a forecast: the history, then the forecast with its band, as rows of
 * { x, actual, forecast, lower, upper }. The last actual point starts the forecast line.
 */
export function forecastRows(points, periods = DEFAULT_PERIODS) {
  const result = holt(points.map((p) => p.y), periods);
  if (!result) return null;
  const rows = points.map((p) => ({ x: String(p.x), actual: p.y }));
  rows[rows.length - 1].forecast = points.at(-1).y;
  const labels = nextLabels(points.map((p) => p.x), periods);
  labels.forEach((x, i) => rows.push({ x: String(x), forecast: result.forecast[i], lower: result.lower[i], upper: result.upper[i] }));
  return { rows, ...result };
}
