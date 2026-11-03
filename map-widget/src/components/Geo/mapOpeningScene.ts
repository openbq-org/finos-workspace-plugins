import { MAP_LIMITS } from "~/lib/codemode/limits";
import type { ShownLayer } from "~/lib/geo/mapLayers";
import { BACKDROP_ZOOMS } from "~/lib/geo/mapOffer";
import { CITY_ZOOM, opensSomewhere, viewLimit } from "~/lib/geo/mapOpening";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import {
  FEW_FIT_ZOOM,
  FEW_MARKS,
  LOCAL_FIT_ZOOM,
  LOCAL_MAX_ZOOM,
  LOCAL_SPAN_DEGREES,
  SHAPE_FIT_ZOOM,
  SHAPE_MAX_ZOOM,
  STANDING_MAX_ZOOM,
} from "./mapGeometry";
import type { Base } from "./scene/base";
import type { Draft, Scene } from "./scene/draft";
import type { SceneLayer } from "./sceneLayer";
import { heldSource } from "./sourceLayers";

export const STREET_ZOOM = BACKDROP_ZOOMS.streets;

const CITY_REACH = 0.5;

type Opened = Pick<
  Scene,
  | "bounds"
  | "outside"
  | "abroad"
  | "opening"
  | "backdropZoom"
  | "streets"
  | "openingLimit"
  | "elsewhere"
> &
  Partial<Pick<Scene, "maxZoom" | "detailZoom">>;

export function sceneOpening(
  spec: MapSpec,
  draft: Draft,
  layers: readonly SceneLayer[],
  shown: readonly ShownLayer[],
  base: Pick<Base, "facts">,
): Opened {
  const { all, near, inside, total, abroad } = draft.view();
  const shaped = layers.some(
    (layer) =>
      layer.kind === "image" ||
      (layer.count > 0 && (layer.kind === "lines" || layer.kind === "polygons")),
  );
  const view = opensSomewhere(spec.view) ? spec.view : undefined;
  const elsewhere = all
    ? shown.flatMap((layer) => {
        if (layer.kind !== "source") return [];
        const found = heldSource(draft.held, layer.source);
        if (!("source" in found)) return [];
        const box = found.source.bounds;
        if (!box) return [];
        const apart =
          all[2] < box[0] || all[0] > box[2] || all[3] < box[1] || all[1] > box[3];
        return apart ? [layer.name ?? found.source.name] : [];
      })
    : [];
  const few = total <= FEW_MARKS;
  const standing = draft.standing.length > 0;
  const opensNear = draft.unwrap && inside < total && inside >= total * 0.8;
  const oneArea =
    all !== null &&
    all[2] - all[0] <= LOCAL_SPAN_DEGREES &&
    all[3] - all[1] <= LOCAL_SPAN_DEGREES;
  const local =
    !shaped &&
    total >= 2 &&
    all !== null &&
    (all[2] - all[0] > 0 || all[3] - all[1] > 0) &&
    oneArea;
  const place = view?.place !== undefined && view.zoom === undefined;
  const within =
    place &&
    local &&
    few &&
    all !== null &&
    (view?.bounds
      ? all[0] >= view.bounds[0] &&
        all[1] >= view.bounds[1] &&
        all[2] <= view.bounds[2] &&
        all[3] <= view.bounds[3]
      : view?.center
        ? Math.abs((all[0] + all[2]) / 2 - view.center[0]) <= CITY_REACH &&
          Math.abs((all[1] + all[3]) / 2 - view.center[1]) <= CITY_REACH &&
          Math.max(all[2] - all[0], all[3] - all[1]) <= CITY_REACH / 10
        : false);
  const streets = base.facts.maxZoom >= STREET_ZOOM;
  const limit = viewLimit({
    viewZoom: base.facts.viewZoom,
    streets,
    detailed: shaped || layers.some((layer) => layer.kind === "source"),
    total,
    box: all,
  });
  return {
    bounds: opensNear ? near : all,
    outside: opensNear ? total - inside : 0,
    abroad: opensNear ? abroad : 0,
    ...(view && !within ? { opening: view } : {}),
    backdropZoom: base.facts.viewZoom,
    streets,
    ...(view && !within && limit !== null ? { openingLimit: limit } : {}),
    elsewhere,
    ...(shaped
      ? {
          maxZoom: Math.max(
            base.facts.maxZoom,
            standing ? STANDING_MAX_ZOOM : SHAPE_MAX_ZOOM,
          ),
          detailZoom: Math.max(
            base.facts.detailZoom,
            standing || (few && total >= 2 && oneArea) ? FEW_FIT_ZOOM : SHAPE_FIT_ZOOM,
          ),
        }
      : local
        ? {
            maxZoom: Math.max(
              base.facts.maxZoom,
              few ? SHAPE_MAX_ZOOM : LOCAL_MAX_ZOOM,
            ),
            detailZoom: Math.max(
              base.facts.detailZoom,
              few ? FEW_FIT_ZOOM : LOCAL_FIT_ZOOM,
            ),
          }
        : {}),
    ...(view && !within
      ? {
          maxZoom: Math.max(
            base.facts.maxZoom,
            standing
              ? STANDING_MAX_ZOOM
              : shaped
                ? SHAPE_MAX_ZOOM
                : local
                  ? LOCAL_MAX_ZOOM
                  : 0,
            limit ??
              Math.max(
                Math.min(MAP_LIMITS.viewZoom, (view.zoom ?? CITY_ZOOM) + 2),
                view.bounds ? LOCAL_MAX_ZOOM : 0,
              ),
          ),
        }
      : {}),
  };
}
