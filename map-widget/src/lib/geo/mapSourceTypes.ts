export const MAP_SOURCE_KINDS = [
  "raster-tiles",
  "vector-tiles",
  "pmtiles",
  "geojson",
  "image",
  "raster-dem",
] as const;
export type MapSourceKind = (typeof MAP_SOURCE_KINDS)[number];

export const isTileKind = (kind: MapSourceKind): boolean =>
  kind === "raster-tiles" || kind === "vector-tiles" || kind === "raster-dem";

export const DEM_ENCODINGS = ["terrarium", "mapbox"] as const;
export type DemEncoding = (typeof DEM_ENCODINGS)[number];

export type MapSourceRole = "overlay" | "imagery";

export interface SourceStyleLayer {
  sourceLayer?: string;
  type: "fill" | "line" | "circle";
  color:
    | string
    | {
        property: string;
        scale: "sequential" | "diverging";
        domain: [number, number];
      };
  opacity?: number;
  width?: number;
  radius?: number;
  label?: string;
}

export interface MapSourceFacts {
  id: string;
  name: string;
  kind: MapSourceKind;
  attribution: string;
  role: MapSourceRole;
  opacity?: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
  tileSize?: 256 | 512;
  encoding?: DemEncoding;
  coordinates?: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  layers?: SourceStyleLayer[];
}

export interface MapSourceDeclaration extends MapSourceFacts {
  endpoint?: string;
  url?: string;
}

export interface HeldMapSource extends MapSourceFacts {
  url: string;
  origin: string;
  backend: string;
  headers: Record<string, string>;
}

export interface RefusedMapSource {
  id?: string;
  reason: string;
}

export interface MapSourceDeclarations {
  sources: MapSourceDeclaration[];
  refused: RefusedMapSource[];
}
