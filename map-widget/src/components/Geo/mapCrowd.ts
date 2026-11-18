export interface Dot {
  x: number;
  y: number;
  r: number;
}

export const CROWD_SHARE = 0.1;
export const CROWD_LEAST = 2;
export const GROUP_RADIUS = 30;
export const GROUP_MAX_ZOOM = 12;

export function hiddenDots(dots: readonly Dot[]): number {
  if (dots.length < 2) return 0;
  let largest = 1;
  for (const dot of dots) largest = Math.max(largest, dot.r);
  const cells = new Map<string, number[]>();
  dots.forEach((dot, at) => {
    const key = `${Math.floor(dot.x / largest)}:${Math.floor(dot.y / largest)}`;
    const cell = cells.get(key);
    if (cell) cell.push(at);
    else cells.set(key, [at]);
  });
  let hidden = 0;
  dots.forEach((dot, at) => {
    const cx = Math.floor(dot.x / largest);
    const cy = Math.floor(dot.y / largest);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (other === at) continue;
          const near = dots[other];
          if (Math.hypot(near.x - dot.x, near.y - dot.y) < Math.max(near.r, 1)) {
            hidden++;
            return;
          }
        }
  });
  return hidden;
}

export function crowded(dots: readonly Dot[]): boolean {
  const hidden = hiddenDots(dots);
  return hidden >= Math.max(CROWD_LEAST, Math.ceil(dots.length * CROWD_SHARE));
}

export const SIZED_CROWD_SHARE = 0.5;
export const SIZED_CROWD_LEAST = 10;
export const COINCIDE_PART = 0.5;
export const COINCIDE_LEAST = 2;

export function coincidingDots(dots: readonly Dot[]): number {
  if (dots.length < 2) return 0;
  let largest = 1;
  for (const dot of dots) largest = Math.max(largest, dot.r);
  const cell = Math.max(COINCIDE_LEAST, largest * COINCIDE_PART);
  const cells = new Map<string, number[]>();
  dots.forEach((dot, at) => {
    const key = `${Math.floor(dot.x / cell)}:${Math.floor(dot.y / cell)}`;
    const held = cells.get(key);
    if (held) held.push(at);
    else cells.set(key, [at]);
  });
  let coinciding = 0;
  dots.forEach((dot, at) => {
    const cx = Math.floor(dot.x / cell);
    const cy = Math.floor(dot.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (other === at) continue;
          const near = dots[other];
          const reach = Math.max(
            COINCIDE_LEAST,
            Math.min(near.r, dot.r) * COINCIDE_PART,
          );
          if (Math.hypot(near.x - dot.x, near.y - dot.y) < reach) {
            coinciding++;
            return;
          }
        }
  });
  return coinciding;
}

export function crowdedSized(dots: readonly Dot[]): boolean {
  const coinciding = coincidingDots(dots);
  return (
    coinciding >=
    Math.max(SIZED_CROWD_LEAST, Math.ceil(dots.length * SIZED_CROWD_SHARE))
  );
}

export const placeKey = (lon: number, lat: number): string =>
  `${Math.round(lon * 1e6)}:${Math.round(lat * 1e6)}`;

export const TRACK_SHARE = 0.5;

export function onTrack(
  points: readonly { lon: number; lat: number }[],
  joints: ReadonlySet<string>,
): boolean {
  if (!joints.size || points.length < 2) return false;
  let on = 0;
  for (const point of points) if (joints.has(placeKey(point.lon, point.lat))) on++;
  return on >= Math.max(2, Math.ceil(points.length * TRACK_SHARE));
}
