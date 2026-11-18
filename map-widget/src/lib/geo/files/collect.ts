import {
  boundedText,
  checkedStyle,
  isAddress,
  partCount,
  positionCount,
} from "./collectChecks";
import { COUNT_ORDER, type GeoCount, SENTENCES } from "./collectNotes";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import type {
  GeoColumn,
  GeoFeature,
  GeoFileKind,
  GeoFileResult,
  GeoGeometry,
  GeoGroup,
  GeoOverlay,
  GeoPosition,
  GeoStyle,
  GeoValue,
} from "./types";

const DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const NAME_KEYS = ["name", "Name", "NAME", "title", "Title", "TITLE"];

export interface FeatureInput {
  geometry: GeoGeometry;
  properties?: Iterable<readonly [string, unknown]>;
  name?: string;
  description?: string;
  group?: number;
  style?: GeoStyle;
  nameFromProperties?: boolean;
}

export class Collector {
  readonly features: GeoFeature[] = [];
  readonly groups: GeoGroup[] = [];
  readonly overlays: GeoOverlay[] = [];
  private readonly said: string[] = [];
  private readonly counts = new Map<GeoCount, number>();
  private vertices = 0;
  private west = Number.POSITIVE_INFINITY;
  private south = Number.POSITIVE_INFINITY;
  private east = Number.NEGATIVE_INFINITY;
  private north = Number.NEGATIVE_INFINITY;
  private pending = 0;

  note(text: string) {
    const { text: line } = boundedText(text, LIMITS.noteChars);
    if (line && !isAddress(line) && !this.said.includes(line)) this.said.push(line);
  }

  count(what: GeoCount, by = 1) {
    this.counts.set(what, (this.counts.get(what) ?? 0) + by);
  }

  get full(): boolean {
    return this.features.length >= LIMITS.features;
  }

  get room(): number {
    return LIMITS.vertices - this.vertices;
  }

  label(value: string | undefined, max: number): string | undefined {
    if (!value) return undefined;
    const { text, cut } = boundedText(value, max);
    if (!text) return undefined;
    if (isAddress(text)) {
      this.count("addresses");
      return undefined;
    }
    if (cut) this.count("textCut");
    return text;
  }

  group(name: string | undefined, parent?: number): number | undefined {
    if (this.groups.length >= LIMITS.groups) {
      if (!this.counts.has("groupsCut")) this.count("groupsCut");
      return undefined;
    }
    const group: GeoGroup = {
      name: this.label(name, LIMITS.groupNameChars) ?? "Untitled",
    };
    if (parent !== undefined) group.parent = parent;
    this.groups.push(group);
    return this.groups.length - 1;
  }

  private position(raw: unknown): GeoPosition | null {
    if (!Array.isArray(raw)) return null;
    const lon = raw[0];
    const lat = raw[1];
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) return null;
    this.pending += 1;
    return [lon, lat];
  }

  private line(raw: unknown, ring: boolean): GeoPosition[] | "range" | "short" {
    if (!Array.isArray(raw)) return "short";
    const line: GeoPosition[] = [];
    for (const item of raw) {
      const place = this.position(item);
      if (!place) return "range";
      line.push(place);
    }
    if (!ring) return line.length >= 2 ? line : "short";
    if (line.length < 3) return "short";
    const first = line[0];
    const last = line[line.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) line.push([first[0], first[1]]);
    return line.length >= 4 ? line : "short";
  }

  private checked(geometry: GeoGeometry): GeoGeometry | "range" | "short" {
    switch (geometry.type) {
      case "Point": {
        const place = this.position(geometry.coordinates);
        return place ? { type: "Point", coordinates: place } : "range";
      }
      case "MultiPoint": {
        const places: GeoPosition[] = [];
        for (const item of geometry.coordinates) {
          const place = this.position(item);
          if (!place) return "range";
          places.push(place);
        }
        if (places.length === 0) return "short";
        return places.length === 1
          ? { type: "Point", coordinates: places[0] }
          : { type: "MultiPoint", coordinates: places };
      }
      case "LineString": {
        const line = this.line(geometry.coordinates, false);
        return typeof line === "string"
          ? line
          : { type: "LineString", coordinates: line };
      }
      case "MultiLineString": {
        const lines: GeoPosition[][] = [];
        for (const part of geometry.coordinates) {
          const line = this.line(part, false);
          if (line === "range") return line;
          if (line !== "short") lines.push(line);
        }
        if (lines.length === 0) return "short";
        return lines.length === 1
          ? { type: "LineString", coordinates: lines[0] }
          : { type: "MultiLineString", coordinates: lines };
      }
      case "Polygon": {
        const rings = this.rings(geometry.coordinates);
        return typeof rings === "string"
          ? rings
          : { type: "Polygon", coordinates: rings };
      }
      case "MultiPolygon": {
        const polygons: GeoPosition[][][] = [];
        if (!Array.isArray(geometry.coordinates)) return "short";
        for (const part of geometry.coordinates) {
          const rings = this.rings(part);
          if (rings === "range") return rings;
          if (rings !== "short") polygons.push(rings);
        }
        if (polygons.length === 0) return "short";
        return polygons.length === 1
          ? { type: "Polygon", coordinates: polygons[0] }
          : { type: "MultiPolygon", coordinates: polygons };
      }
      default:
        return "short";
    }
  }

  private rings(raw: unknown): GeoPosition[][] | "range" | "short" {
    if (!Array.isArray(raw) || raw.length === 0) return "short";
    const rings: GeoPosition[][] = [];
    for (let at = 0; at < raw.length; at++) {
      const ring = this.line(raw[at], true);
      if (ring === "range") return ring;
      if (ring === "short") {
        if (at === 0) return "short";
        continue;
      }
      rings.push(ring);
    }
    return rings;
  }

  private properties(
    entries: Iterable<readonly [string, unknown]> | undefined,
  ): Record<string, GeoValue> {
    const properties: Record<string, GeoValue> = {};
    if (!entries) return properties;
    let kept = 0;
    for (const [rawKey, raw] of entries) {
      if (kept >= LIMITS.properties) {
        if (!this.counts.has("propertiesCut")) this.count("propertiesCut");
        break;
      }
      if (typeof rawKey !== "string") continue;
      const { text: key } = boundedText(rawKey, LIMITS.propertyNameChars);
      if (!key || key === "__proto__" || Object.hasOwn(properties, key)) continue;
      if (isAddress(key)) {
        this.count("addresses");
        continue;
      }
      let value: GeoValue;
      if (raw === null || raw === undefined) value = null;
      else if (typeof raw === "number") value = Number.isFinite(raw) ? raw : null;
      else if (typeof raw === "boolean") value = raw;
      else {
        let written: string;
        if (typeof raw === "string") written = raw;
        else
          try {
            written = JSON.stringify(raw) ?? "";
          } catch {
            written = "";
          }
        const { text, cut } = boundedText(written, LIMITS.propertyValueChars);
        if (isAddress(text)) {
          this.count("addresses");
          continue;
        }
        if (cut) this.count("textCut");
        value = text;
      }
      properties[key] = value;
      kept += 1;
    }
    return properties;
  }

  add(input: FeatureInput) {
    if (this.full) {
      if (!this.counts.has("featuresCut")) this.count("featuresCut");
      return;
    }
    if (partCount(input.geometry) > LIMITS.parts) return this.count("partsCut");
    if (positionCount(input.geometry) > this.room) return this.count("verticesCut");
    this.pending = 0;
    const geometry = this.checked(input.geometry);
    if (geometry === "range") return this.count("outOfRange");
    if (geometry === "short") return this.count("badGeometry");
    this.vertices += this.pending;
    this.extend(geometry.coordinates);
    const properties = this.properties(input.properties);
    const feature: GeoFeature = { type: "Feature", geometry, properties };
    let name = input.name;
    if (!name && input.nameFromProperties)
      for (const key of NAME_KEYS) {
        const value = properties[key];
        if (typeof value === "string" && value) {
          name = value;
          break;
        }
      }
    const label = this.label(name, LIMITS.nameChars);
    if (label) feature.name = label;
    if (input.description) {
      const { text, cut } = boundedText(input.description, LIMITS.descriptionChars);
      if (cut) this.count("textCut");
      if (text) feature.description = text;
    }
    if (input.group !== undefined) feature.group = input.group;
    const style = checkedStyle(input.style);
    if (style) feature.style = style;
    this.features.push(feature);
  }

  extend(coordinates: unknown): void {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") {
      const [lon, lat] = coordinates as GeoPosition;
      if (lon < this.west) this.west = lon;
      if (lon > this.east) this.east = lon;
      if (lat < this.south) this.south = lat;
      if (lat > this.north) this.north = lat;
      return;
    }
    for (const part of coordinates) this.extend(part);
  }

  private columns(): GeoColumn[] {
    const kinds = new Map<string, GeoColumn["kind"] | "">();
    for (const feature of this.features)
      for (const key of Object.keys(feature.properties)) {
        const known = kinds.get(key);
        if (known === undefined && kinds.size >= LIMITS.columns) continue;
        const value = feature.properties[key];
        if (value === null) {
          if (known === undefined) kinds.set(key, "");
          continue;
        }
        const kind =
          typeof value === "number"
            ? "number"
            : typeof value === "string" && DATE.test(value)
              ? "date"
              : "text";
        kinds.set(key, !known || known === kind ? kind : "text");
      }
    return Array.from(kinds, ([name, kind]) => ({ name, kind: kind || "text" }));
  }

  finish(kind: GeoFileKind): GeoFileResult {
    const notes = [...this.said];
    for (const what of COUNT_ORDER) {
      const count = this.counts.get(what);
      if (count) notes.push(SENTENCES[what](count));
    }
    return {
      kind,
      features: this.features,
      groups: this.groups,
      overlays: this.overlays,
      columns: this.columns(),
      notes: notes.slice(0, LIMITS.notes),
      bounds:
        this.west <= this.east ? [this.west, this.south, this.east, this.north] : null,
    };
  }
}
