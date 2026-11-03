import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useResizeDetector } from "react-resize-detector";
import { type MapNotes, mapNotes } from "~/lib/geo/mapNotes";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { MapCamera, MapViewState } from "~/lib/geo/mapViewState";
import { hostedBasemapUrl } from "~/lib/geo/basemapUrl";
import { useSettings } from "~/settings";
import { surfaceOf, useTheme } from "~/theme";
import {
  columnsShown,
  opensOnCity,
  sceneFrame,
  standingShown,
  tallBuildingsShown,
} from "./applyMapView";
import MapAround from "./MapAround";
import { marksReach } from "./mapFit";
import { insideMap } from "./mapInside";
import { buildScene } from "./mapScene";
import { MAP_THEMES } from "./mapTheme";
import { described, type MapBeyond, mapNote, mapNoteLines } from "./mapWords";
import type { Scene } from "./scene/sceneTypes";
import { useContextTilt } from "./useContextTilt";
import { useLibraryMap } from "./useLibraryMap";
import { useMapBoundaries } from "./useMapBoundaries";
import { useMapBuildings } from "./useMapBuildings";
import {
  AREA_BEARING,
  AREA_PITCH,
  COLUMN_BEARING,
  COLUMN_PITCH,
  type KeptCamera,
  type MapPlacement,
  type MapTarget,
  useMapCamera,
} from "./useMapCamera";
import { useMapCard } from "./useMapCard";
import { useMapCrowd } from "./useMapCrowd";
import { useBasemap, useHeldArchives, useMapData } from "./useMapData";
import { useMapDataTable } from "./useMapDataTable";
import { useMapDraw } from "./useMapDraw";
import { useMapOutline } from "./useMapOutline";
import { useMapShapes } from "./useMapShapes";
import { useMapShown } from "./useMapShown";
import { useMapSources } from "./useMapSources";
import { type MapCanvasSlot, useMapStill } from "./useMapStill";
import { useMapStyle } from "./useMapStyle";
import { useMapTags } from "./useMapTags";
import { useAskedView, useMapView } from "./useMapView";
import { useMapZoom, useZoomEnd } from "./useMapZoom";

const NO_FILTER: readonly string[] = [];
const NOT_LOADED = "The map could not be loaded. The data of the map is in the table.";

export interface MapViewProps {
  spec: unknown;
  name: string;

  notes?: unknown;

  onNotesChange?: (notes: MapNotes) => void;

  view?: unknown;

  onViewChange?: (view: MapViewState) => void;


  shapes?: unknown;

  onShapesChange?: (shapes: DrawnShape[]) => void;


  expanded?: boolean;


  target?: MapTarget | null;
}

const MapCanvas = memo(function MapCanvas({
  spec: given,
  name,
  notes,
  onNotesChange,
  view: storedView,
  onViewChange,
  shapes: storedShapes,
  onShapesChange,
  expanded = false,
  onFail,
  onContextLost,
  slot,
  keepsCamera = false,
  target,
}: Omit<MapViewProps, "spec"> & {
  spec: MapSpec;

  keepsCamera?: boolean;

  onFail: (reason: string) => void;

  onContextLost?: () => void;

  slot?: MapCanvasSlot;
}) {
  const live = slot?.live ?? true;
  const still = slot?.still ?? null;
  const pluginTheme = useTheme();
  const dark = pluginTheme.mode === "dark";
  const { width, height, ref } = useResizeDetector<HTMLDivElement>({
    refreshMode: "debounce",
    refreshRate: 50,
  });
  const holder = useRef<HTMLDivElement>(null);
  const tagLayer = useRef<HTMLDivElement>(null);
  const markerLayer = useRef<HTMLDivElement>(null);
  const layersButton = useRef<HTMLButtonElement>(null);
  const dataButton = useRef<HTMLButtonElement>(null);
  const fail = useCallback(() => onFail(NOT_LOADED), [onFail]);
  const data = useMapData(given, fail);

  const spec = data?.spec ?? given;
  const lib = data?.lib;
  const { mapTilesUrl, mapTilesProvider } = useSettings();
  const basemap = useBasemap(
    lib,
    hostedBasemapUrl(mapTilesUrl),
    mapTilesProvider,
    dark,
  );
  const held = useMapSources();
  const archives = useHeldArchives(lib, held.sources);
  const [readerView, setReaderView] = useMapView(storedView, onViewChange);

  const [view, setView] = useAskedView(spec, readerView, setReaderView);
  const kept = useMemo(() => mapNotes(notes), [notes]);

  const sea = useMemo(
    () => (width && height ? surfaceOf(pluginTheme) : null),
    [pluginTheme, width, height],
  );
  const map = useLibraryMap({
    live,
    lib,
    holder,
    expanded,
    onFail,
    onContextLost,
  });
  const theme = dark ? MAP_THEMES.dark : MAP_THEMES.light;
  const draw = useMapDraw({ map, stored: storedShapes, onChange: onShapesChange });

  const filter = (view.inside ?? NO_FILTER).join(",");
  const inside = useMemo(() => {
    const ids = filter ? filter.split(",") : NO_FILTER;
    const chosen = draw.rested.filter((shape) => ids.includes(shape.id));
    const made = insideMap(spec, chosen);
    return made.spec === spec
      ? null
      : { ...made, ids: chosen.map((shape) => shape.id) };
  }, [spec, draw.rested, filter]);
  const shownSpec = inside?.spec ?? spec;
  const choice = view.basemap?.choice;
  const scene = useMemo(
    () =>
      data && sea && basemap !== undefined && archives
        ? buildScene({
            spec: shownSpec,
            world: data.world,
            states: data.states,
            sets: data.sets,
            unloaded: data.unloaded,
            theme,
            sea,
            basemap,
            held,
            choice,
          })
        : null,
    [data, shownSpec, theme, sea, basemap, archives, held, choice],
  );

  const whole = useRef<{ of: MapSpec; bounds: Scene["bounds"] } | null>(null);
  if (scene && !inside) whole.current = { of: spec, bounds: scene.bounds };
  const cameraBounds =
    inside && whole.current?.of === spec
      ? whole.current.bounds
      : (scene?.bounds ?? null);
  const frame = scene ? sceneFrame(scene, view) : undefined;

  useEffect(() => {
    map
      ?.getCanvas()
      .setAttribute(
        "aria-label",
        `Map ${name}. Arrow keys move it, plus and minus zoom.`,
      );
  }, [map, name]);

  const { crowd, measure } = useMapCrowd(map, scene, frame, spec, slot?.crowd);
  const layers = useMapStyle(map, scene, view, frame, crowd);
  const boundaries = useMapBoundaries(map, scene, view.boundaries, theme);

  const outlined = useMapOutline(map, scene, spec.view?.outline, theme);

  const buildings = useMapBuildings(map, scene, spec, theme);
  const noBuildings = buildings.state === "missing" || buildings.state === "far";
  const shapesDrawn = useMapShapes({
    map,
    scene,
    shapes: draw.shapes,
    shown: view.drawn !== "off" || draw.open,
    theme,
    selected: draw.selected,
    draft: draw.draft,
  });

  const storeCamera = useCallback(
    (camera: MapCamera | null) =>
      setView(({ camera: _before, ...rest }) => (camera ? { ...rest, camera } : rest)),
    [setView],
  );
  const {
    visible,
    credits,
    required,
    grouped,
    shown,
    keys,
    compact,
    legends,
    legendOpen,
  } = useMapShown({ scene, spec, layers, view, frame, crowd, width });

  const [beyond, setBeyond] = useState<MapBeyond>(false);

  const [opened, setOpened] = useState<MapPlacement>(null);
  const keepOpened = useCallback(
    (next: MapPlacement) =>
      setOpened((before) =>
        before === next ||
        (typeof before === "object" &&
          typeof next === "object" &&
          before?.zoom === next?.zoom &&
          before?.box.join() === next?.box.join())
          ? before
          : next,
      ),
    [],
  );
  const said = useMemo(() => mapNote(spec, scene), [spec, scene]);
  const left = useMemo(
    () => mapNoteLines(spec, scene, beyond, noBuildings, opened),
    [spec, scene, beyond, noBuildings, opened],
  );

  const heading = Boolean(spec.title || said);

  const noted =
    Boolean(spec.title) &&
    (Boolean(said) ||
      (scene !== null && !scene.streets && scene.detailZoom > scene.backdropZoom));

  const columns = scene ? columnsShown(scene, view) : false;

  const standing = scene ? standingShown(scene, view) : false;
  const raised = standing && scene !== null && opensOnCity(scene);
  const tilted = columns || raised || (spec.pitch ?? 0) > 0;
  const timed = frame !== undefined && (scene?.frames.length ?? 0) > 1;
  const tall = scene ? tallBuildingsShown(scene, view) : false;

  const [cameraKept, setCameraKept] = useState<KeptCamera | null>(
    () => slot?.camera.current ?? null,
  );

  const bottom = useResizeDetector<HTMLDivElement>({
    handleWidth: false,
    refreshMode: "debounce",
    refreshRate: 50,
  });
  const reach = useMemo(() => (scene ? marksReach(scene.marks) : 0), [scene]);
  const { reset, fitAll, zoom, tilt } = useMapCamera({
    map,
    bounds: cameraBounds,
    reach,
    detailZoom: scene?.detailZoom ?? 0,
    heading,
    noted,
    legend: legends > 0,
    legendList: legends > 1,
    slider: timed ? (compact ? "compact" : "wide") : null,
    bottomRoom: compact && bottom.height ? bottom.height : undefined,
    opening: scene?.opening ?? null,
    openingLimit: scene?.openingLimit,
    backdropZoom: scene && !scene.streets ? scene.backdropZoom : undefined,
    onBeyond: setBeyond,
    onOpened: keepOpened,

    onPlaced: measure,
    tilted,
    pitch: columns
      ? COLUMN_PITCH
      : (spec.pitch ?? (raised ? AREA_PITCH : COLUMN_PITCH)),
    bearing: columns ? COLUMN_BEARING : raised ? AREA_BEARING : 0,
    target,
    pitchable: tall || standing,
    camera: slot?.camera,
    cameraOf: spec,
    onCamera: slot ? setCameraKept : undefined,
    stored: keepsCamera ? view.camera : undefined,
    onStore: keepsCamera ? storeCamera : undefined,
  });
  const zoomNow = useMapZoom(map);
  const zoomEnd = useZoomEnd(map, scene?.maxZoom);
  const changeView = useContextTilt({
    scene,
    setView,
    tall,
    tilted,
    zoom: zoomNow,
    tilt,
  });



  const [hiddenTags, setHiddenTags] = useState(0);
  useMapTags({
    map,
    scene,
    notes: kept,
    heading,
    shown,
    grouped,
    legends: legendOpen ? Math.min(4, legends) : 0,
    bottomHeight: bottom.height,

    controls:
      5 +
      1 +
      (scene?.opening ? 1 : 0) +
      (draw.can ? 2 : 1),
    tagLayer,
    markerLayer,
    onHidden: setHiddenTags,
  });
  const card = useMapCard({
    map: draw.open || draw.measuring ? null : map,
    scene,
    spec,
    expanded,
    shown,
    layers,
    notes: kept,
    onNotesChange,
  });
  const { dataOpen, toggleData, closeData } = useMapDataTable(map);
  const label = useMemo(() => described(name, spec), [name, spec]);
  const covered = useMapStill({
    slot,
    map,
    scene,
    width,
    height,
    dark,
    spec,
    notes,
    view,
    drawn: `${boundaries.drawn}|${shapesDrawn}|${buildings.drawn}|${outlined}`,
    camera: cameraKept,
    tagLayer,
    markerLayer,
  });

  return (

    <div role="group" aria-label={label} className="not-prose relative min-h-0 flex-1">
      <div ref={ref} className="absolute inset-1 overflow-hidden rounded-sm">
        {}
        <div ref={holder} className="h-full w-full" />
        {covered && (
          <img
            src={still.url}
            alt=""
            draggable={false}
            data-map-still
            style={still.shown}
            className="pointer-events-none absolute left-0 top-0 max-w-none"
          />
        )}
        <div
          ref={markerLayer}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        />
        <div
          ref={tagLayer}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        />
        {!map && !still && (

          <p
            role="status"
            className="absolute left-0 top-0 z-10 m-0 px-3 py-2 text-xs text-ds-text-caption"
          >
            Loading the map...
          </p>
        )}
        {(map || still) && scene && (
          <MapAround
            name={name}
            spec={spec}
            scene={scene}
            view={view}
            setView={setView}
            changeView={changeView}
            layers={layers}
            visible={visible}
            grouped={grouped}
            crowd={crowd}
            shown={shown}
            keys={keys}
            credits={credits}
            required={required}
            compact={compact}
            step={timed ? frame : undefined}
            heading={heading}
            noteLines={left}
            zoomNow={zoomNow}
            zoomEnd={zoomEnd}
            kept={kept}
            onNotesChange={onNotesChange}
            zoom={zoom}
            reset={reset}
            fitAll={fitAll}
            dataOpen={dataOpen}
            toggleData={toggleData}
            closeData={closeData}
            layersButton={layersButton}
            dataButton={dataButton}
            barRef={bottom.ref}
            hiddenTags={hiddenTags}
            onPlaying={slot?.onPlaying}
            card={card}
            boundaries={boundaries.states}
            draw={draw}
            theme={theme}
            inside={inside}
            bottomRoom={bottom.height}
          />
        )}
      </div>
    </div>
  );
});

export default MapCanvas;
