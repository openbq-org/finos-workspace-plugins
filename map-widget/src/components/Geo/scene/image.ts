import type { SourceSpecification } from "maplibre-gl";
import { bytesOf } from "~/lib/geo/base64";
import type { MapBounds } from "~/lib/geo/mapSummary";
import { grow } from "../mapGeometry";
import type { Builder, ScenePicture } from "./draft";

export const imageLayer: Builder<"image"> = (draft, layer, to) => {
  const { corners } = layer.image;
  let box: MapBounds | null = null;
  for (const [lon, lat] of corners) box = grow(box, [lon, lat, lon, lat]);
  draft.reach(box);
  draft.pictures.push({ source: to.base, image: layer.image });
  to.add(
    "backdrop",
    {
      id: to.base,
      type: "raster",
      source: to.base,
      paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
    },
    { "raster-opacity": 1 },
  );
  return { count: 0, swatch: "raster" };
};

export function pictureSources(pictures: readonly ScenePicture[]): {
  sources: Record<string, SourceSpecification>;
  urls: string[];
} {
  const sources: Record<string, SourceSpecification> = {};
  const urls: string[] = [];
  for (const { source, image } of pictures) {
    const bytes = bytesOf(image.data);
    if (!bytes) continue;
    let url: string;
    try {
      url = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
    } catch {
      continue;
    }
    urls.push(url);
    sources[source] = { type: "image", url, coordinates: image.corners };
  }
  return { sources, urls };
}
