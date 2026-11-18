import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useMemo,
} from "react";
import Icon from "~/components/Icon";
import type { MapContextId } from "~/lib/geo/mapContext";
import { layerVisible, type MapViewState } from "~/lib/geo/mapViewState";
import type { SceneContext } from "./basemapContext";
import { LayerPanelBoundaries } from "./LayerPanelBoundaries";
import { LayerPanelContext } from "./LayerPanelContext";
import { LayerPanelRow, ShowSwitch } from "./LayerPanelRow";
import {
  type BasemapPart,
  groupLabels,
  groupVisible,
  opacityPercent,
  setBasemapChoice,
  setBasemapPart,
  setLayerGrouped,
  setLayerOpacity,
  setPanelOpen,
  toggleGroup,
  toggleLayer,
} from "./layerPanelState";
import { FOCUS } from "./mapControlStyles";
import { useMapPanelHost } from "./mapPanelHost";
import type { SceneLayer } from "./sceneLayer";
import type { BoundaryStates } from "./useMapBoundaries";
import type { SetMapView } from "./useMapView";
import { usePanelFocus } from "./usePanelFocus";

interface LayerPanelProps {
  layers: readonly SceneLayer[];
  view: MapViewState;
  grouped?: ReadonlySet<string>;
  crowded?: ReadonlySet<string>;
  onViewChange: SetMapView;
  basemaps: readonly { id: string; name: string }[];
  basemap: string;
  basemapParts: { names: boolean; roads: boolean; borders: boolean };
  context?: readonly SceneContext[];
  contextAsked?: readonly MapContextId[];
  boundaries?: BoundaryStates;
  zoom?: number;
  compact: boolean;
  opener?: RefObject<HTMLElement | null>;
  drawn?: number;
}

const PARTS: readonly { part: BasemapPart; label: string }[] = [
  { part: "names", label: "Place names" },
  { part: "roads", label: "Roads" },
  { part: "borders", label: "Borders" },
];
const NO_CONTEXT: readonly SceneContext[] = [];
const NO_CHOICES: readonly { id: string; name: string }[] = [];
const NONE_ASKED: readonly MapContextId[] = [];
const HEADING = "ws-uppercase-small-title";
const CHOICE = "flex h-5 cursor-pointer items-center gap-1.5 text-ds-text-body";

type Section = { group?: string; layers: SceneLayer[] };

function sections(layers: readonly SceneLayer[]): Section[] {
  const list: Section[] = [];
  const folders = new Map<string, Section>();
  for (let at = layers.length - 1; at >= 0; at--) {
    const layer = layers[at];
    if (!layer.group) {
      list.push({ layers: [layer] });
      continue;
    }
    const folder = folders.get(layer.group);
    if (folder) folder.layers.push(layer);
    else {
      const made = { group: layer.group, layers: [layer] };
      folders.set(layer.group, made);
      list.push(made);
    }
  }
  return list;
}

const LayerPanel = memo(function LayerPanel({
  layers,
  view,
  grouped,
  crowded,
  onViewChange,
  basemaps,
  basemap,
  basemapParts,
  context = NO_CONTEXT,
  contextAsked = NONE_ASKED,
  boundaries,
  zoom = 0,
  compact,
  opener,
  drawn = 0,
}: LayerPanelProps) {
  const name = useId();
  const host = useMapPanelHost();
  const { panel, first: closeButton } = usePanelFocus<HTMLElement, HTMLButtonElement>(
    opener,
  );
  const listed = useMemo(() => sections(layers), [layers]);
  const folders = useMemo(
    () => groupLabels(layers.flatMap((layer) => (layer.group ? [layer.group] : []))),
    [layers],
  );
  const close = useCallback(
    () => onViewChange((view) => setPanelOpen(view, false)),
    [onViewChange],
  );
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    },
    [close],
  );
  const toggleDrawn = useCallback(
    () =>
      onViewChange(({ drawn: before, ...rest }) =>
        before === "off" ? rest : { ...rest, drawn: "off" },
      ),
    [onViewChange],
  );
  const toggle = useCallback(
    (layer: SceneLayer) => onViewChange((view) => toggleLayer(view, layer)),
    [onViewChange],
  );
  const fade = useCallback(
    (layer: SceneLayer, value: number) =>
      onViewChange((view) => setLayerOpacity(view, layer, value)),
    [onViewChange],
  );
  const group = useCallback(
    (layer: SceneLayer, on: boolean) =>
      onViewChange((view) =>
        setLayerGrouped(view, layer, on, crowded?.has(layer.id) ?? false),
      ),
    [onViewChange, crowded],
  );
  const row = (layer: SceneLayer) => (
    <LayerPanelRow
      key={layer.id}
      layer={layer}
      on={layerVisible(layer, view)}
      grouped={layer.groupable ? (grouped?.has(layer.id) ?? false) : undefined}
      onGroup={group}
      percent={opacityPercent(layer, view)}
      compact={compact}
      farOut={layer.from !== undefined && zoom < layer.from}
      onToggle={toggle}
      onOpacity={fade}
    />
  );
  const parts = useMemo(
    () => PARTS.filter(({ part }) => basemapParts[part]),
    [basemapParts],
  );
  const choices = basemaps.length > 1 ? basemaps : NO_CHOICES;
  return (
    <section
      ref={panel}
      aria-label="Layers"
      data-map-layers={compact ? "compact" : "wide"}
      onKeyDown={onKey}
      className={`absolute right-10 top-2 z-20 flex max-h-[calc(100%-36px)] flex-col overflow-hidden rounded border border-general-border-primary bg-general-bg-primary text-xs leading-4 text-ds-text-body shadow-light-2 ${compact ? "left-2" : "w-[232px]"}`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-surface-divider py-0.5 pl-2 pr-1">
        <h3 className="m-0 text-xs font-medium leading-4 text-ds-text-heading">
          Layers
        </h3>
        <button
          ref={closeButton}
          type="button"
          aria-label="Close layers"
          title="Close"
          onClick={close}
          className={`flex size-5 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover ${FOCUS}`}
        >
          <Icon id="x-close" className="size-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {listed.length === 0 && (
          <p className="m-0 px-2 py-0.5 text-ds-text-caption">
            {host?.empty ?? "This map has no layers."}
          </p>
        )}
        <ul aria-label="Layers of the map" className="m-0 list-none p-0">
          {listed.map((section) =>
            section.group === undefined ? (
              row(section.layers[0])
            ) : (
              <LayerGroup
                key={`group:${section.group}`}
                group={section.group}
                label={folders.get(section.group) ?? section.group}
                layers={layers}
                on={groupVisible(layers, section.group, view)}
                onViewChange={onViewChange}
              >
                {section.layers.map(row)}
              </LayerGroup>
            ),
          )}
        </ul>
        {host?.actions}
        {drawn > 0 && (
          <fieldset className="m-0 mt-1 min-w-0 border-0 border-t border-solid border-surface-divider px-2 pb-0 pt-1">
            <legend className="sr-only">My shapes</legend>
            <label className="flex h-5 cursor-pointer items-center gap-1.5 text-ds-text-body">
              <input
                type="checkbox"
                checked={view.drawn !== "off"}
                onChange={toggleDrawn}
                className={`m-0 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
              />
              <span className="min-w-0 flex-1 truncate">My shapes</span>
              <span className="shrink-0 text-ds-text-caption">
                {drawn.toLocaleString("en-US")}
              </span>
            </label>
          </fieldset>
        )}
        <LayerPanelBoundaries
          on={view.boundaries}
          states={boundaries}
          zoom={zoom}
          onViewChange={onViewChange}
        />
        {(choices.length > 0 || parts.length > 0) && (
          <div className="mt-1 border-t border-surface-divider px-2 pt-1">
            <div className={HEADING}>Basemap</div>
            {choices.length > 0 && (
              <div role="radiogroup" aria-label="Basemap">
                {choices.map((choice) => (
                  <BasemapChoice
                    key={choice.id}
                    choice={choice}
                    name={name}
                    checked={choice.id === basemap}
                    basemaps={basemaps}
                    onViewChange={onViewChange}
                  />
                ))}
              </div>
            )}
            {parts.map(({ part, label }) => (
              <BasemapSwitch
                key={part}
                part={part}
                label={label}
                on={view.basemap?.[part] !== false}
                onViewChange={onViewChange}
              />
            ))}
            <LayerPanelContext
              context={context}
              asked={contextAsked}
              zoom={zoom}
              basemap={view.basemap}
              onViewChange={onViewChange}
            />
          </div>
        )}
      </div>
    </section>
  );
});

const LayerGroup = memo(function LayerGroup({
  group,
  label,
  layers,
  on,
  onViewChange,
  children,
}: {
  group: string;
  label: string;
  layers: readonly SceneLayer[];
  on: boolean;
  onViewChange: SetMapView;
  children: ReactNode;
}) {
  const toggle = useCallback(
    () => onViewChange((view) => toggleGroup(view, layers, group)),
    [onViewChange, layers, group],
  );
  return (
    <li>
      <div className="flex h-5 items-center gap-1.5 px-2">
        <ShowSwitch
          label={`Show the group ${group}`}
          on={on}
          disabled={layers.every((layer) => layer.group !== group || layer.note)}
          onToggle={toggle}
        />
        <span title={group} className={`min-w-0 flex-1 truncate ${HEADING}`}>
          {label}
        </span>
      </div>
      <ul
        aria-label={group}
        className="m-0 ml-[17px] list-none border-l border-surface-divider p-0"
      >
        {children}
      </ul>
    </li>
  );
});

const BasemapChoice = memo(function BasemapChoice({
  choice,
  name,
  checked,
  basemaps,
  onViewChange,
}: {
  choice: { id: string; name: string };
  name: string;
  checked: boolean;
  basemaps: readonly { id: string }[];
  onViewChange: SetMapView;
}) {
  const choose = useCallback(
    () => onViewChange((view) => setBasemapChoice(view, choice.id, basemaps)),
    [onViewChange, choice.id, basemaps],
  );
  return (
    <label className={CHOICE}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={choose}
        className={`m-0 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
      />
      <span title={choice.name} className="min-w-0 flex-1 truncate">
        {choice.name}
      </span>
    </label>
  );
});

const BasemapSwitch = memo(function BasemapSwitch({
  part,
  label,
  on,
  onViewChange,
}: {
  part: BasemapPart;
  label: string;
  on: boolean;
  onViewChange: SetMapView;
}) {
  const flip = useCallback(
    () => onViewChange((view) => setBasemapPart(view, part, !on)),
    [onViewChange, part, on],
  );
  return (
    <label className={CHOICE}>
      <input
        type="checkbox"
        checked={on}
        onChange={flip}
        className={`m-0 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
      />
      <span>{label}</span>
    </label>
  );
});

export default LayerPanel;
