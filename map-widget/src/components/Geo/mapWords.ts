import { countedArea, inViewNote, marksInView } from "~/lib/geo/mapInView";
import { layerMarks, layerName, mapLayers, type ShownLayer } from "~/lib/geo/mapLayers";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { MAP_CREDITS } from "~/lib/geo/markBudget";
import { REGION_SET_WORDS } from "~/lib/geo/regions/regionTypes";
import type { Scene } from "./scene/sceneTypes";
import type { MapPlacement } from "./useMapCamera";

const CREDIT_NOTES: ReadonlySet<string> = new Set(
  Object.values(MAP_CREDITS).map(({ note }) => note),
);

export const requiredCredits = (spec: MapSpec): string[] =>
  (spec.credits ?? []).map((id) => MAP_CREDITS[id].shown);

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function held(layer: ShownLayer): string {
  const n = layerMarks(layer).length;
  switch (layer.kind) {
    case "regions":
      return count(n, "shaded region");
    case "lines":
      return count(n, "line");
    case "polygons":
      return count(n, "area");
    case "heat":
      return `density of ${count(n, "point")}`;
    case "clusters":
      return `${count(n, "point")} in clusters`;
    case "flows":
      return count(n, "flow");
    case "columns":
      return count(n, "column");
    case "source":
      return "a source of a backend";
    case "image":
      return "a picture";
    default:
      return count(n, "point");
  }
}

export function described(name: string, spec: MapSpec): string {
  const layers = mapLayers(spec);
  const steps = new Set(
    layers.flatMap((layer) => layerMarks(layer).flatMap((mark) => mark.time ?? [])),
  ).size;
  const time = steps > 1 ? `, over ${steps} steps of time` : "";
  if (!spec.layers?.length)
    return `Map ${name}: ${layers.map(held).join(", ")}${
      spec.valueLabel ? `, by ${spec.valueLabel}` : ""
    }${time}`;
  return `Map ${name}: ${count(layers.length, "layer")}: ${layers
    .map((layer) => `${layerName(layer)} (${held(layer)})`)
    .join(", ")}${time}`;
}

export const NAMED = 5;
const listed = (items: readonly string[], total: number, between = ", ") =>
  `${items.slice(0, NAMED).join(between)}${total > NAMED ? `${between}...` : "."}`;

export const BUILDINGS_NOTE =
  "Building outlines need the detailed basemap at street zoom.";

export const STREET_NOTE = "Street detail needs a detailed basemap.";
export const HELD_NOTE =
  "Street detail needs a detailed basemap: this is the closest view this one shows.";
export const HELD_PLAIN_NOTE =
  "No basemap is drawn here, only land outlines: this is the closest view they show.";

export type MapBeyond = false | "past" | "held";

function inViewSaid(spec: MapSpec, opened: MapPlacement | undefined): string | null {
  if (opened === "data") return null;
  const view = spec.view;
  if (countedArea(view) === "map-widget")
    return inViewNote(marksInView(spec, view?.box, view?.zoom), "map-widget");
  const asked = view?.bounds;
  return asked
    ? inViewNote(marksInView(spec, opened?.box ?? asked, opened?.zoom ?? view?.zoom))
    : null;
}

export function mapNote(...given: Parameters<typeof mapNoteLines>): string | null {
  const notes = mapNoteLines(...given);
  return notes.length ? notes.join(" ") : null;
}

export function mapNoteLines(
  spec: MapSpec,
  scene:
    | (Pick<Scene, "unshaped" | "ambiguous" | "outside" | "abroad" | "elsewhere"> &
        Partial<Pick<Scene, "backdrop" | "refused">>)
    | null,
  beyond: MapBeyond = false,
  noBuildings = false,
  opened?: MapPlacement,
): string[] {
  const unmatched: string[] = [];
  let missing = 0;
  for (const layer of mapLayers(spec)) {
    const regions =
      layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;
    unmatched.push(...(regions?.unmatched ?? []));
    missing += regions?.unmatchedCount ?? 0;
  }
  unmatched.push(...(scene?.unshaped ?? []));
  missing += scene?.unshaped.length ?? 0;
  const unsure = scene?.ambiguous ?? [];
  const refused = scene?.refused ?? [];
  return [
    missing
      ? `${count(missing, "region is", "regions are")} not on the map: ${listed(unmatched, missing)}`
      : "",
    unsure.length
      ? `${count(unsure.length, "region could be", "regions could be")} several: ${listed(
          unsure.map(
            ({ code, candidates }) => `${code}: ${candidates.slice(0, 4).join(" or ")}`,
          ),
          unsure.length,
          "; ",
        )} ${[...new Set(unsure.map(({ set }) => REGION_SET_WORDS[set].apart))].join(" ")}`
      : "",
    scene?.outside
      ? `${scene.outside} more outside this view (${
          !scene.abroad
            ? "Alaska, Hawaii, territories"
            : scene.abroad === scene.outside
              ? "outside the United States"
              : `${scene.abroad} outside the United States`
        }): zoom out.`
      : "",
    inViewSaid(spec, opened) ?? "",
    beyond === "held"
      ? scene?.backdrop === "plain"
        ? HELD_PLAIN_NOTE
        : HELD_NOTE
      : beyond
        ? STREET_NOTE
        : "",
    refused.length
      ? `${count(refused.length, "map source is", "map sources are")} not drawn: ${listed(
          refused.map(({ id, reason }) => `${id ?? "a source"}: ${reason.replace(/\.$/, "")}`),
          refused.length,
          "; ",
        )}`
      : "",
    noBuildings ? BUILDINGS_NOTE : "",
    ...(scene?.elsewhere ?? []).map(
      (name) =>
        `"${name}" has no data in this area: it covers another part of the world.`,
    ),
    ...(spec.notes ?? []).filter((note) => !CREDIT_NOTES.has(note)),
  ].filter(Boolean);
}

export function noteHead(note: string): string {
  const listAt = note.indexOf(": ");
  if (listAt < 0 || !/^[0-9]/.test(note)) return note;
  const asideAt = note.indexOf(" (");
  return note.slice(0, asideAt >= 0 && asideAt < listAt ? asideAt : listAt);
}
