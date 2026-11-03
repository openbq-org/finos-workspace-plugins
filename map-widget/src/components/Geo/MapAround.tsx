import {
  type ComponentProps,
  lazy,
  memo,
  type RefObject,
  Suspense,
  useCallback,
  useMemo,
} from "react";
import type { MapExportFormat } from "~/lib/geo/files/exportModel";
import type { MapNotes } from "~/lib/geo/mapNotes";
import { shapeName } from "~/lib/geo/mapShapes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import type { MapViewState } from "~/lib/geo/mapViewState";
import LayerPanel from "./LayerPanel";
import { setLegendClosed, setPanelOpen } from "./layerPanelState";
import { MapCard } from "./MapCard";
import { MapControls } from "./MapControls";
import MapDataTable from "./MapDataTable";
import MapLegends from "./MapLegends";
import { MapBottom, MapCredit, MapHeading } from "./MapParts";
import { FOCUS } from "./mapControlStyles";
import { saveMapFile } from "./mapDownload";
import type { legendKeys } from "./mapLegendKeys";
import type { MapTheme } from "./mapTheme";
import type { Scene, SceneMark } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";
import TimeSlider from "./TimeSlider";
import type { BoundaryStates } from "./useMapBoundaries";
import type { useMapCamera } from "./useMapCamera";
import type { useMapCard } from "./useMapCard";
import type { MapDraw } from "./useMapDraw";
import type { SetMapView } from "./useMapView";

const MapDrawPanel = lazy(() => import("./draw/MapDrawPanel"));

const MORE_TAGS = `flex h-5 items-center rounded border border-general-border-primary bg-general-bg-primary/95 px-1.5 text-xs font-medium leading-4 text-ds-text-heading shadow-light-1 hover:bg-general-bg-primary-hover ${FOCUS}`;

type Camera = ReturnType<typeof useMapCamera>;
const NO_IDS: readonly string[] = [];
const CHIP =
  "flex h-5 max-w-56 items-center gap-1 rounded border border-general-border-primary bg-general-bg-primary/95 pl-1.5 pr-0.5 text-xs font-medium leading-4 text-ds-text-heading shadow-light-1";

const MapAround = memo(function MapAround({
  name,
  spec,
  scene,
  view,
  setView,
  changeView,
  layers,
  visible,
  grouped,
  crowd,
  shown,
  keys,
  credits,
  required,
  compact,
  step,
  heading,
  noteLines,
  zoomNow,
  zoomEnd,
  kept,
  onNotesChange,
  zoom,
  reset,
  fitAll,
  dataOpen,
  toggleData,
  closeData,
  layersButton,
  dataButton,
  barRef,
  hiddenTags,
  onPlaying,
  card,
  boundaries,
  draw,
  theme,
  inside,
  bottomRoom,
}: {
  name: string;
  spec: MapSpec;
  scene: Scene;
  view: MapViewState;
  setView: SetMapView;

  changeView: SetMapView;
  layers: readonly SceneLayer[];

  visible: readonly SceneLayer[];
  grouped: ReadonlySet<string>;
  crowd: ReadonlySet<string>;

  shown: (mark: SceneMark) => boolean;
  keys: ReturnType<typeof legendKeys>;
  credits: readonly string[];
  required: readonly string[];

  compact: boolean;

  step?: string;
  heading: boolean;

  noteLines: readonly string[];
  zoomNow: number;

  zoomEnd: boolean;

  kept: MapNotes;
  onNotesChange?: (notes: MapNotes) => void;
  zoom: Camera["zoom"];
  reset: Camera["reset"];
  fitAll: Camera["fitAll"];
  dataOpen: boolean;
  toggleData: () => void;
  closeData: () => void;
  layersButton: RefObject<HTMLButtonElement>;
  dataButton: RefObject<HTMLButtonElement>;
  barRef: ComponentProps<typeof MapBottom>["barRef"];

  hiddenTags: number;
  onPlaying?: (playing: boolean) => void;
  card: ReturnType<typeof useMapCard>;

  boundaries?: BoundaryStates;

  draw: MapDraw;
  theme: MapTheme;

  inside: { ids: readonly string[]; kept: number; total: number } | null;

  bottomRoom?: number;
}) {
  const {
    openMark,
    openIndex,
    pinned,
    unpin,
    cardRef,
    openKey,
    setNoteOf,
    setNote,
    valueLabel,
    sizeLabel,
    numbers,
  } = card;

  const listedMarks = useMemo(
    () => (scene.listed.length ? [...scene.marks, ...scene.listed] : scene.marks),
    [scene],
  );

  const exportAs = useCallback(
    (format: MapExportFormat) =>
      void saveMapFile(spec, format, { notes: kept, name, shapes: draw.shapes }),
    [spec, kept, name, draw.shapes],
  );

  const toolOpen = draw.open || draw.measuring;
  const panelOpen = view.panel === "open" && !toolOpen;
  const closeDraw = draw.close;

  const togglePanel = useCallback(() => {
    closeDraw();
    setView((now) => setPanelOpen(now, now.panel !== "open" || toolOpen));
  }, [setView, closeDraw, toolOpen]);
  const toggleDraw = useCallback(() => {
    setView((now) => setPanelOpen(now, false));
    draw.toggle();
  }, [setView, draw.toggle]);
  const toggleMeasure = useCallback(() => {
    setView((now) => setPanelOpen(now, false));
    draw.toggleMeasure();
  }, [setView, draw.toggleMeasure]);
  const setInside = useCallback(
    (id: string, on: boolean) =>
      setView(({ inside: before = [], ...rest }) => {
        const next = before.filter((other) => other !== id);
        if (on) next.push(id);
        return next.length ? { ...rest, inside: next } : rest;
      }),
    [setView],
  );
  const clearInside = useCallback(
    () => setView(({ inside: _before, ...rest }) => rest),
    [setView],
  );

  const filteredBy = useMemo(
    () =>
      inside
        ? draw.shapes
            .filter((shape) => inside.ids.includes(shape.id))
            .map((shape) => shapeName(shape, draw.shapes))
            .join(", ")
        : "",
    [inside, draw.shapes],
  );
  const insideIds = inside?.ids ?? NO_IDS;
  const toggleLegend = useCallback(
    () => setView((now) => setLegendClosed(now, now.legend !== "closed")),
    [setView],
  );
  const setFrame = useCallback(
    (next: string) => setView((now) => ({ ...now, frame: next })),
    [setView],
  );

  return (
    <>
      <MapControls
        onZoom={zoom}
        zoomEnd={zoomEnd}
        onReset={reset}
        onFitAll={scene.opening ? fitAll : undefined}
        onLayers={dataOpen ? undefined : togglePanel}
        layersOpen={panelOpen}
        layersRef={layersButton}
        onData={toggleData}
        onExport={exportAs}
        dataOpen={dataOpen}
        dataRef={dataButton}
        onDraw={draw.can && !dataOpen ? toggleDraw : undefined}
        drawOpen={draw.open}
        onMeasure={dataOpen ? undefined : toggleMeasure}
        measureOpen={draw.measuring}
      />
      {dataOpen ? (
        <MapDataTable
          name={name}
          marks={listedMarks}
          shown={shown}
          layers={layers}
          notes={kept}
          onNote={onNotesChange ? setNoteOf : undefined}
          onClose={closeData}
          step={step}
          opener={dataButton}
          credits={required}
          shapes={draw.shapes}
        />
      ) : (
        <>
          {(heading || noteLines.length > 0) && (
            <MapHeading title={spec.title} notes={noteLines} />
          )}
          {panelOpen && (
            <LayerPanel
              layers={layers}
              view={view}
              grouped={grouped}
              crowded={crowd}
              onViewChange={changeView}
              basemaps={scene.basemaps}
              basemap={scene.backdrop}
              basemapParts={scene.basemapParts}
              context={scene.context}
              contextAsked={scene.contextAsked}
              boundaries={boundaries}
              zoom={zoomNow}
              compact={compact}
              opener={layersButton}
              drawn={draw.shapes.length}
            />
          )}
          {toolOpen && (
            <Suspense fallback={null}>
              <MapDrawPanel
                draw={draw}
                theme={theme}
                inside={insideIds}
                onInside={setInside}
                bottomRoom={bottomRoom}
              />
            </Suspense>
          )}
          <MapCredit
            credit={scene.credit ?? ""}
            sources={credits}
            required={required}
          />
          <MapBottom
            compact={compact}
            barRef={barRef}
            slider={
              step !== undefined ? (
                <TimeSlider
                  frames={scene.frames}
                  frame={step}
                  onFrame={setFrame}
                  compact={compact}
                  onPlaying={onPlaying}
                />
              ) : undefined
            }
            legend={
              <MapLegends
                layers={visible}
                closed={view.legend === "closed"}
                onToggle={toggleLegend}
                compact={compact}
                grouped={grouped}
                categories={scene.categories}
                categoryLabel={scene.categoryLabel}
                keys={keys}
              />
            }
            notice={
              inside && !(panelOpen && compact) ? (
                <div
                  role="status"
                  data-map-inside
                  title={`Only the marks inside ${filteredBy} are shown: ${inside.kept.toLocaleString("en-US")} of ${inside.total.toLocaleString("en-US")}.`}
                  className={CHIP}
                >
                  <span className="min-w-0 truncate">{`Filtered by: ${filteredBy}`}</span>
                  <span className="shrink-0 font-normal text-ds-text-caption">
                    {`${inside.kept.toLocaleString("en-US")} of ${inside.total.toLocaleString("en-US")}`}
                  </span>
                  <button
                    type="button"
                    aria-label="Clear the filter: show all marks"
                    title="Show all marks"
                    onClick={clearInside}
                    className={`flex size-4 shrink-0 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover ${FOCUS}`}
                  >
                    <span aria-hidden>×</span>
                  </button>
                </div>
              ) : undefined
            }
            aside={
              hiddenTags > 0 ? (
                <button
                  type="button"
                  onClick={toggleData}
                  title={`${hiddenTags.toLocaleString("en-US")} more ${hiddenTags === 1 ? "tag does" : "tags do"} not fit on the map as it is shown. Zoom in, or open the data of the map.`}
                  className={MORE_TAGS}
                >
                  {`+${hiddenTags.toLocaleString("en-US")} ${hiddenTags === 1 ? "tag" : "tags"}`}
                </button>
              ) : undefined
            }
          />
          {openMark && (
            <MapCard

              key={openMark.key ?? openIndex}
              mark={openMark}
              valueLabel={valueLabel}
              sizeLabel={sizeLabel}
              numbers={numbers}
              pinned={openIndex === pinned}
              note={openKey ? kept[openKey] : undefined}
              onNote={onNotesChange ? setNote : undefined}
              onClose={unpin}
              cardRef={cardRef}
            />
          )}
        </>
      )}
    </>
  );
});

export default MapAround;
