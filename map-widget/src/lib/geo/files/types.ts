export type GeoPosition = [lon: number, lat: number];

export type GeoGeometry =
  | { type: "Point"; coordinates: GeoPosition }
  | { type: "MultiPoint"; coordinates: GeoPosition[] }
  | { type: "LineString"; coordinates: GeoPosition[] }
  | { type: "MultiLineString"; coordinates: GeoPosition[][] }
  | { type: "Polygon"; coordinates: GeoPosition[][] }
  | { type: "MultiPolygon"; coordinates: GeoPosition[][][] };

export type GeoValue = string | number | boolean | null;

export interface GeoStyle {
  color?: string;
  lineWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
}

export interface GeoFeature {
  type: "Feature";
  geometry: GeoGeometry;
  properties: Record<string, GeoValue>;
  name?: string;
  description?: string;
  group?: number;
  style?: GeoStyle;
}

export interface GeoGroup {
  name: string;
  parent?: number;
}

export type GeoImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface GeoOverlay {
  name: string;
  corners: [GeoPosition, GeoPosition, GeoPosition, GeoPosition];
  image: { bytes: Uint8Array; mime: GeoImageMime; width: number; height: number };
  group?: number;
}

export interface GeoColumn {
  name: string;
  kind: "number" | "text" | "date";
}

export type GeoFileKind = "kml" | "kmz" | "shapefile" | "gpx" | "geojson";

export interface GeoFileResult {
  kind: GeoFileKind;
  features: GeoFeature[];
  groups: GeoGroup[];
  overlays: GeoOverlay[];
  columns: GeoColumn[];
  notes: string[];
  bounds: [west: number, south: number, east: number, north: number] | null;
  title?: string;
  map?: Record<string, unknown>;
}

export type GeoFileErrorCode =
  | "unknown-format"
  | "malformed"
  | "too-large"
  | "refused"
  | "unsupported-projection"
  | "empty"
  | "internal";

export interface GeoFileError {
  code: GeoFileErrorCode;
  message: string;
}

export type GeoFileOutcome =
  | { ok: true; file: GeoFileResult; error?: undefined }
  | { ok: false; error: GeoFileError; file?: undefined };

export interface GeoFileHint {
  name?: string;
  mime?: string;
}

export class GeoFileFailure extends Error {
  readonly code: GeoFileErrorCode;

  constructor(code: GeoFileErrorCode, message: string) {
    super(message);
    this.name = "GeoFileFailure";
    this.code = code;
  }
}

export const failFile = (code: GeoFileErrorCode, message: string): never => {
  throw new GeoFileFailure(code, message);
};
