export type Position = [number, number];

export const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

export function kmBetween([lonA, latA]: Position, [lonB, latB]: Position): number {
  const dLat = (latB - latA) * RAD;
  const dLon = (lonB - lonA) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * RAD) * Math.cos(latB * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function placeAt([lon, lat]: Position, km: number, bearing: number): Position {
  const angular = km / EARTH_KM;
  const turn = bearing * RAD;
  const y = Math.asin(
    Math.sin(lat * RAD) * Math.cos(angular) +
      Math.cos(lat * RAD) * Math.sin(angular) * Math.cos(turn),
  );
  const x =
    lon * RAD +
    Math.atan2(
      Math.sin(turn) * Math.sin(angular) * Math.cos(lat * RAD),
      Math.cos(angular) - Math.sin(lat * RAD) * Math.sin(y),
    );
  return [x / RAD, y / RAD];
}

export const CIRCLE_SIDES = 72;

export function circleRing(
  centre: Position,
  km: number,
  sides = CIRCLE_SIDES,
): Position[] {
  const ring: Position[] = [];
  let before = centre[0];
  for (let at = 0; at < sides; at++) {
    const [x, y] = placeAt(centre, km, (at / sides) * 360);
    const lon = x + 360 * Math.round((before - x) / 360);
    before = lon;
    ring.push([lon, y]);
  }
  ring.push(ring[0]);
  return ring;
}

export const insideCircle = (place: Position, centre: Position, km: number): boolean =>
  kmBetween(place, centre) <= km;

function inRing(x: number, y: number, ring: readonly Position[]): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a];
    const [xb, yb] = ring[b];
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa)
      inside = !inside;
  }
  return inside;
}

export function insideRing(place: Position, ring: readonly Position[]): boolean {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  for (const [x] of ring) {
    if (x < west) west = x;
    if (x > east) east = x;
  }
  const [x, y] = place;
  if (inRing(x, y, ring)) return true;
  if (east > 180 && inRing(x + 360, y, ring)) return true;
  return west < -180 && inRing(x - 360, y, ring);
}
