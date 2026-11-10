import { useEffect, useMemo, useRef, useState } from "react";
import { mapLayers } from "~/lib/geo/mapLayers";
import type { MapRegions } from "~/lib/geo/mapMarkTypes";
import { isDeferredSet } from "~/lib/geo/mapMarkTypes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { type Boundaries, loadBoundaries } from "~/lib/geo/regions/boundaries";
import { isRegionSet } from "~/lib/geo/regions/codes";
import type { RegionSetId } from "~/lib/geo/regions/regionTypes";
import {
  loadRegionIndex,
  loadRegionShapes,
  matchRegion,
  regionInfo,
} from "~/lib/geo/regions/registry";
import { type RegionShapes, regionShapesOfBoundaries } from "~/lib/geo/regions/shapes";
import { aboutUnitedStates } from "./mapGeometry";
import type { HeldMapSource } from "~/lib/geo/mapSourceTypes";
import {
  type Basemap,
  type BasemapProvider,
  loadBasemap,
  readHeldArchives,
} from "./basemap";
import { loadMapLibrary } from "./mapLibrary";
import type { RegionShapeSets, RegionShapeSource } from "./scene/draft";

export interface MapData {
  lib: typeof import("maplibre-gl");
  world: Boundaries;
  states: Boundaries | null;
  sets: RegionShapeSets;
  unloaded: RegionSetId[];
}

export function regionSetsOf(spec: MapSpec): Map<RegionSetId, MapRegions[]> {
  const sets = new Map<RegionSetId, MapRegions[]>();
  for (const layer of mapLayers(spec)) {
    const regions =
      layer.kind === "regions" || layer.kind === "columns" ? layer.regions : undefined;
    if (!regions?.items.length) continue;
    sets.set(regions.set, [...(sets.get(regions.set) ?? []), regions]);
  }
  return sets;
}

export function registrySource(
  set: RegionSetId,
  parts: readonly RegionShapes[],
  deferred: boolean,
): RegionShapeSource {
  return {
    fine: true,
    shapeOf: (id) => {
      for (const part of parts) {
        const shape = part.shapeOf(id);
        if (shape) return shape;
      }
      return undefined;
    },
    info: (id) => {
      const known = regionInfo(set, id);
      return known && { name: known.name, short: known.short, centre: known.centroid };
    },
    ...(deferred ? { resolve: (code, within) => matchRegion(set, code, within) } : {}),
  };
}

async function loadSet(
  set: RegionSetId,
  blocks: readonly MapRegions[],
  signal: AbortSignal,
): Promise<RegionShapeSource> {
  const deferred = isDeferredSet(set);
  if (isRegionSet(set) && set !== "countries") {
    const file = await loadBoundaries(set, signal);
    if (!deferred) return file;
    await loadRegionIndex(set, signal);
    const { shapeOf, info, resolve } = registrySource(
      set,
      [regionShapesOfBoundaries(file)],
      true,
    );
    return { ...file, shapeOf, info, resolve };
  }
  await loadRegionIndex(set, signal);
  const ids = new Set<string>();
  for (const { items, within } of blocks)
    for (const { code } of items) {
      const match = deferred ? matchRegion(set, code, within) : { id: code };
      if (match && "id" in match) ids.add(match.id);
    }
  return registrySource(set, await loadRegionShapes(set, ids, signal), deferred);
}

export interface LoadedMap extends MapData {
  spec: MapSpec;
}

export function useMapData(spec: MapSpec, onFail: () => void): LoadedMap | null {
  const [loaded, setLoaded] = useState<{ request: string; data: MapData } | null>(null);
  const wanted = useMemo(() => regionSetsOf(spec), [spec]);
  const key = useMemo(
    () =>
      [...wanted]
        .map(([set, blocks]) =>
          isRegionSet(set) && set !== "countries"
            ? set
            : `${set}:${blocks
                .map(
                  ({ items, within }) =>
                    `${within?.country ?? ""}/${within?.state ?? ""}/${items.map((item) => item.code).join("|")}`,
                )
                .join(";")}`,
        )
        .sort()
        .join(","),
    [wanted],
  );
  const american = aboutUnitedStates(spec);
  const request = `${american ? "us" : "world"}|${key}`;
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const ids = [...wanted.keys()];
    const states =
      american && !wanted.has(STATES_WITHIN)
        ? loadBoundaries("us-states", signal).catch(() => null)
        : null;
    Promise.all([
      loadMapLibrary(),
      loadBoundaries("countries", signal),
      states,
      Promise.allSettled(ids.map((set) => loadSet(set, wanted.get(set) ?? [], signal))),
    ]).then(
      ([lib, world, states, shapes]) => {
        if (signal.aborted) return;
        const sets: RegionShapeSets = {};
        const unloaded: RegionSetId[] = [];
        ids.forEach((set, at) => {
          const shape = shapes[at];
          if (shape.status === "fulfilled") sets[set] = shape.value;
          else unloaded.push(set);
        });
        setLoaded({ request, data: { lib, world, states, sets, unloaded } });
      },
      () => {
        if (!signal.aborted) onFail();
      },
    );
    return () => controller.abort();
  }, [request, american, onFail]);

  const drawn = useRef<MapSpec | null>(null);
  if (loaded?.request === request) drawn.current = spec;
  const drawnSpec = drawn.current;
  return useMemo(
    () => (loaded && drawnSpec ? { ...loaded.data, spec: drawnSpec } : null),
    [loaded, drawnSpec],
  );
}

const STATES_WITHIN: RegionSetId = "us-counties";

export function useBasemap(
  lib: typeof import("maplibre-gl") | undefined,
  tilesUrl: string | null,
  provider: BasemapProvider,
  dark: boolean,
): Basemap | null | undefined {
  const [basemap, setBasemap] = useState<Basemap | null | undefined>(undefined);
  useEffect(() => {
    if (!lib) return;
    let current = true;
    loadBasemap(lib, { tilesUrl, provider }, dark ? "dark" : "light").then((loaded) => {
      if (current) setBasemap(loaded);
    });
    return () => {
      current = false;
    };
  }, [lib, tilesUrl, provider, dark]);
  return basemap;
}

export function useHeldArchives(
  lib: typeof import("maplibre-gl") | undefined,
  sources: readonly HeldMapSource[],
): boolean {
  const files = sources.some((source) => source.kind === "pmtiles");
  const [read, setRead] = useState<readonly HeldMapSource[] | null>(null);
  useEffect(() => {
    if (!lib || !files) return;
    let current = true;
    const done = () => {
      if (current) setRead(sources);
    };
    readHeldArchives(lib, sources).then(done, done);
    return () => {
      current = false;
    };
  }, [lib, files, sources]);
  return !files || read === sources;
}
