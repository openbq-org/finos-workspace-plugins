import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import { heldSource, sourceStyle } from "../sourceLayers";
import type { Builder } from "./draft";

function fromZoom(source: HeldMapSource): { from?: number } {
  if (
    !source.minzoom ||
    (source.kind !== "raster-tiles" && source.kind !== "raster-dem")
  )
    return {};
  const from = source.minzoom - Math.round(Math.log2(512 / (source.tileSize ?? 256)));
  return from > 0 ? { from } : {};
}

export const sourceLayer: Builder<"source"> = (draft, layer, to) => {
  const found = heldSource(draft.held, layer.source);
  if ("note" in found) return { count: 0, swatch: "raster", note: found.note };
  const { source } = found;
  const drawn = sourceStyle(source, to.base, draft.theme);
  const facts = {
    count: 0,
    swatch: drawn.swatch,
    attribution: source.attribution,
    ...(layer.name === undefined ? { name: source.name } : {}),
    ...fromZoom(source),
  };
  if (!drawn.source || !drawn.layers.length) return facts;
  draft.sources[to.base] = drawn.source;
  draft.origins[to.base] = layer.id;
  const slot =
    source.kind === "raster-dem"
      ? "relief"
      : source.role === "imagery" && drawn.swatch === "raster"
        ? "backdrop"
        : "overlay";
  for (const part of drawn.layers) to.add(slot, part.spec, part.opacity);
  return facts;
};
