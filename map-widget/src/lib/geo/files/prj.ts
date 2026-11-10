export type PrjKind =
  | { kind: "geographic"; datum: "wgs84" | "nad83" | "other"; name: string }
  | { kind: "web-mercator" }
  | { kind: "projected"; name: string }
  | { kind: "unknown" };

const shown = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 _./()+-]/g, "")
    .replace(/_/g, " ")
    .trim()
    .slice(0, 80);

const WEB_MERCATOR_CODES = new Set(["3857", "900913", "3785", "102100", "102113"]);

export function classifyPrj(text: string): PrjKind {
  const wkt = text.slice(0, 8192).trim();
  const name = shown(/^[A-Za-z_]+\s*\[\s*"([^"]{0,200})"/.exec(wkt)?.[1] ?? "");
  if (/\b(?:PROJCS|PROJCRS|PROJECTEDCRS)\s*\[/i.test(wkt)) {
    const code =
      /(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d{1,7})"?\s*\]\s*\]\s*$/i.exec(
        wkt,
      )?.[1];
    const mercator =
      (code !== undefined && WEB_MERCATOR_CODES.has(code)) ||
      /MERCATOR[_ ]AUXILIARY[_ ]SPHERE|PSEUDO[-_ ]MERCATOR|POPULAR[_ ]VISUALI[SZ]ATION|WEB[_ ]MERCATOR/i.test(
        wkt,
      );
    return mercator ? { kind: "web-mercator" } : { kind: "projected", name };
  }
  if (/\b(?:GEOGCS|GEOGCRS|GEODCRS|GEOGRAPHICCRS|GEODETICCRS)\s*\[/i.test(wkt)) {
    if (!/UNIT\s*\[\s*"degree/i.test(wkt)) return { kind: "projected", name };
    const datum = /WGS[_ ]?(?:19)?84/i.test(wkt)
      ? "wgs84"
      : /NAD[_ ]?(?:19)?83|NORTH[_ ]AMERICAN[_ ](?:DATUM[_ ])?1983/i.test(wkt)
        ? "nad83"
        : "other";
    return { kind: "geographic", datum, name };
  }
  return { kind: "unknown" };
}

const RADIUS = 6378137;
const EDGE = Math.PI * RADIUS * 1.000001;

export function fromWebMercator(x: number, y: number): [number, number] {
  if (!(Math.abs(x) <= EDGE && Math.abs(y) <= EDGE)) return [Number.NaN, Number.NaN];
  const lon = Math.max(-180, Math.min(180, (x / RADIUS) * (180 / Math.PI)));
  const lat = (2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.round(lon * 1e9) / 1e9, Math.round(lat * 1e9) / 1e9];
}
