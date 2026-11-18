import { memo, type Ref, useCallback } from "react";
import Icon from "~/components/Icon";
import type { MapExportFormat } from "~/lib/geo/files/exportModel";
import MapExportMenu from "./MapExportMenu";
import { FOCUS } from "./mapControlStyles";
import { DrawIcon, FitIcon, LayersIcon, MeasureIcon } from "./mapIcons";

const BUTTON = `flex size-6 items-center justify-center text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover focus-visible:ring-inset ${FOCUS}`;

const ENDED = "cursor-default opacity-40 hover:bg-transparent hover:text-general-label";

const ZOOM_END = "Zoom in: this map has no more detail closer than this";

export const MapControls = memo(function MapControls({
  onZoom,
  zoomEnd = false,
  onReset,
  onFitAll,
  onLayers,
  layersOpen = false,
  layersRef,
  onData,
  onExport,
  dataOpen = false,
  dataRef,
  onDraw,
  drawOpen = false,
  onMeasure,
  measureOpen = false,
}: {
  onZoom: (by: number) => void;

  zoomEnd?: boolean;
  onReset: () => void;

  onFitAll?: () => void;
  onLayers?: () => void;
  layersOpen?: boolean;

  layersRef?: Ref<HTMLButtonElement>;
  onData?: () => void;

  onExport?: (format: MapExportFormat) => void;
  dataOpen?: boolean;

  dataRef?: Ref<HTMLButtonElement>;

  onDraw?: () => void;
  drawOpen?: boolean;

  onMeasure?: () => void;
  measureOpen?: boolean;
}) {
  const zoomIn = useCallback(() => {
    if (!zoomEnd) onZoom(1);
  }, [onZoom, zoomEnd]);
  const zoomOut = useCallback(() => onZoom(-1), [onZoom]);
  return (
    <div
      role="toolbar"
      aria-label="Map view"
      data-map-overlay
      className="absolute right-2 top-2 z-10 flex flex-col divide-y divide-surface-divider overflow-hidden rounded border border-general-border-primary bg-general-bg-primary shadow-light-1"
    >
      <button
        type="button"
        className={zoomEnd ? `${BUTTON} ${ENDED}` : BUTTON}
        aria-label="Zoom in"
        aria-disabled={zoomEnd}
        title={zoomEnd ? ZOOM_END : "Zoom in"}
        onClick={zoomIn}
      >
        <Icon id="plus" className="size-3.5" />
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label="Zoom out"
        title="Zoom out"
        onClick={zoomOut}
      >
        <Icon id="minus-icon" className="size-3.5" />
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label="Reset view"
        title={
          onFitAll
            ? "Reset view: return to the view the map opened on"
            : "Reset view: fit the map to its data"
        }
        onClick={onReset}
      >
        {}
        <Icon id="radix-icons-reset" className="size-3.5" />
      </button>
      {onFitAll && (
        <button
          type="button"
          className={BUTTON}
          aria-label="Show all data"
          title="Show all data: fit the map to all its marks"
          onClick={onFitAll}
        >
          <FitIcon className="size-3.5" />
        </button>
      )}
      {onLayers && (
        <button
          ref={layersRef}
          type="button"
          className={`${BUTTON} ${layersOpen ? "bg-general-bg-primary-hover text-general-label-hover" : ""}`}
          aria-label="Layers"
          aria-expanded={layersOpen}
          title="Layers: what the map shows"
          onClick={onLayers}
        >
          <LayersIcon className="size-3.5" />
        </button>
      )}
      {onDraw && (
        <button
          type="button"
          className={`${BUTTON} ${drawOpen ? "bg-general-bg-primary-hover text-general-label-hover" : ""}`}
          aria-label="Draw"
          aria-expanded={drawOpen}
          title="Draw: add a point, a line, an area, a rectangle or a circle to the map"
          onClick={onDraw}
        >
          <DrawIcon className="size-3.5" />
        </button>
      )}
      {onMeasure && (
        <button
          type="button"
          className={`${BUTTON} ${measureOpen ? "bg-general-bg-primary-hover text-general-label-hover" : ""}`}
          aria-label="Measure"
          aria-expanded={measureOpen}
          title="Measure a distance or an area on the map"
          onClick={onMeasure}
        >
          <MeasureIcon className="size-3.5" />
        </button>
      )}
      {onData && (
        <button
          ref={dataRef}
          type="button"
          className={`${BUTTON} ${dataOpen ? "bg-general-bg-primary-hover text-general-label-hover" : ""}`}
          aria-label="Show data"
          aria-pressed={dataOpen}
          title={
            dataOpen ? "Show the map" : "Show data: the marks of the map as a table"
          }
          onClick={onData}
        >
          <Icon id="table-02" className="size-3.5" />
        </button>
      )}
      {onExport && (
        <MapExportMenu onExport={onExport}>
          <button
            type="button"
            className={BUTTON}
            aria-label="Export map"
            title="Export the map as a file: KML, KMZ or GeoJSON"
          >
            <Icon id="download" className="size-3.5" />
          </button>
        </MapExportMenu>
      )}
    </div>
  );
});
