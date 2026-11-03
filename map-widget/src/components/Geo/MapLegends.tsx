import { memo, useCallback, useMemo, useState } from "react";
import Icon from "~/components/Icon";
import { LayerSwatch } from "./LayerSwatch";
import { groupLabels } from "./layerPanelState";
import MapCategoryKey from "./MapCategoryKey";
import { LEGEND_BOX, LegendBar, MapLegend, scaleEnds } from "./MapParts";
import { FOCUS } from "./mapControlStyles";
import type { LegendKey } from "./mapLegendKeys";
import { MARKER_PATHS } from "./mapSigns";
import type { SceneLayer } from "./sceneLayer";

const MAX_ENTRIES = 4;

interface MapLegendsProps {
  layers: readonly SceneLayer[];
  closed: boolean;
  onToggle: () => void;
  compact: boolean;
  grouped?: ReadonlySet<string>;
  categories?: readonly { name: string; color: string }[];
  categoryLabel?: string;
  keys?: readonly LegendKey[];
}

const NO_KEYS: readonly LegendKey[] = [];

const KeySign = memo(function KeySign({
  sign,
  tone,
}: Pick<LegendKey, "sign" | "tone">) {
  if (!sign) return null;
  const color = tone ?? "var(--brand-main)";
  if (sign === "ring" || sign === "highlight")
    return (
      <span
        aria-hidden
        className="box-border size-3 shrink-0 rounded-full border-2"
        style={{
          borderColor: color,
          ...(sign === "highlight"
            ? { background: `color-mix(in srgb, ${color} 30%, transparent)` }
            : {}),
        }}
      />
    );
  return (
    <span
      aria-hidden
      className="flex size-3 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none text-general-bg-primary"
      style={{ background: color }}
    >
      {sign === "rank" ? (
        "1"
      ) : (
        <svg
          viewBox="0 0 16 16"
          width="9"
          height="9"
          fill="currentColor"
          fillRule="evenodd"
        >
          <title>{sign}</title>
          <path d={MARKER_PATHS[sign]} />
        </svg>
      )}
    </span>
  );
});

const LegendKeys = memo(function LegendKeys({ keys }: { keys: readonly LegendKey[] }) {
  return (
    <ul data-map-legend-keys className="m-0 flex list-none flex-col gap-0.5 p-0">
      {keys.map((key) => (
        <li key={key.id} className="flex min-w-0 items-start gap-1.5">
          <KeySign sign={key.sign} tone={key.tone} />
          <span
            title={key.text}
            className={`min-w-0 break-words ${key.sign ? "" : "text-ds-text-caption"}`}
          >
            {key.text}
          </span>
        </li>
      ))}
    </ul>
  );
});

const NO_CATEGORIES: readonly { name: string; color: string }[] = [];
const NOT_GROUPED: ReadonlySet<string> = new Set();
export const COMPACT_LINES = 5;
const COMPACT_CATEGORIES = 3;

const isHeat = (layer: SceneLayer) =>
  layer.swatch === "heat" && Boolean(layer.ramp?.length);

const AVERAGED = "Circles: the average of their points";

const LegendEntry = memo(function LegendEntry({
  layer,
  name,
  averaged,
}: {
  layer: SceneLayer;
  name: string;
  averaged: boolean;
}) {
  if (layer.scale)
    return (
      <>
        <LegendBar
          label={name}
          detail={
            layer.valueLabel === layer.name || layer.valueLabel === name
              ? undefined
              : layer.valueLabel
          }
          {...scaleEnds(layer.scale, layer.valueLabel ?? layer.name)}
        />
        {averaged && <div className="text-ds-text-caption">{AVERAGED}</div>}
      </>
    );
  if (isHeat(layer))
    return (
      <LegendBar label={name} stops={layer.ramp ?? []} low="sparse" high="dense" />
    );
  return (
    <div className="flex items-start gap-1.5">
      <LayerSwatch layer={layer} />
      <span title={name} className="min-w-0 break-words">
        {name}
      </span>
    </div>
  );
});

const MapLegends = memo(function MapLegends({
  layers,
  closed,
  onToggle,
  compact,
  grouped = NOT_GROUPED,
  categories = NO_CATEGORIES,
  categoryLabel,
  keys = NO_KEYS,
}: MapLegendsProps) {
  const [opened, setOpened] = useState<boolean | null>(null);
  const sharing = useMemo(() => {
    const counts = new Map<unknown, number>();
    for (const layer of layers)
      if (layer.scale) counts.set(layer.scale, (counts.get(layer.scale) ?? 0) + 1);
    return counts;
  }, [layers]);
  const entries = useMemo(() => {
    const several = layers.length > 1;
    const listed: SceneLayer[] = [];
    const scales = new Set<unknown>();
    for (let at = layers.length - 1; at >= 0; at--) {
      const layer = layers[at];
      const keyed = !layer.scale && Boolean(layer.categories?.length);
      if (layer.scale && scales.has(layer.scale)) continue;
      if (layer.scale) scales.add(layer.scale);
      if ((several && !keyed) || layer.scale || isHeat(layer)) listed.push(layer);
    }
    return listed;
  }, [layers]);
  const shown = useMemo(() => {
    if (entries.length <= MAX_ENTRIES) return entries;
    const valued = entries.filter((layer) => layer.scale || isHeat(layer));
    const plain = entries.filter((layer) => !layer.scale && !isHeat(layer));
    const kept = new Set([...valued, ...plain].slice(0, MAX_ENTRIES));
    return entries.filter((layer) => kept.has(layer));
  }, [entries]);
  const names = useMemo(() => {
    const folders = groupLabels(
      entries.flatMap((layer) => (layer.group ? [layer.group] : [])),
    );
    const count = (name: string) =>
      entries.filter((layer) => layer.name === name).length;
    const tails = groupLabels(entries.map((layer) => layer.name));
    return new Map(
      entries.map((layer) => [
        layer.id,
        layer.scale &&
        ((sharing.get(layer.scale) ?? 0) > 1 ||
          (entries.length === 1 && !categories.length)) &&
        layer.valueLabel
          ? layer.valueLabel
          : layer.group && count(layer.name) > 1
            ? `${layer.name} (${folders.get(layer.group) ?? layer.group})`
            : (tails.get(layer.name) ?? layer.name),
      ]),
    );
  }, [entries, sharing, categories]);
  const list = entries.length > 1 || categories.length > 0;
  const lines =
    entries.reduce((sum, layer) => sum + (layer.scale || isHeat(layer) ? 2 : 1), 0) +
    (categories.length
      ? Math.ceil(categories.length / COMPACT_CATEGORIES) + (categoryLabel ? 1 : 0)
      : 0) +
    keys.length;
  const waits = compact && list && lines > COMPACT_LINES;
  const folded = closed || (opened === null ? waits : waits && !opened);
  const toggle = useCallback(() => {
    setOpened(folded);
    if (closed || !waits) onToggle();
  }, [folded, closed, waits, onToggle]);

  if (!entries.length && !categories.length && !keys.length) return null;
  if (folded)
    return (
      <button
        type="button"
        aria-expanded={false}
        data-map-legend="closed"
        title="Show the legend"
        onClick={toggle}
        className={`flex h-5 items-center gap-1 rounded border border-general-border-primary bg-general-bg-primary/95 pl-1.5 pr-1 text-xs font-medium leading-4 text-ds-text-heading shadow-light-1 hover:bg-general-bg-primary-hover ${FOCUS}`}
      >
        Legend
        <Icon id="chevron-right" className="size-3 text-general-label" />
      </button>
    );
  const [only] = entries;
  if (entries.length === 1 && only.scale && !categories.length && !keys.length)
    return (
      <MapLegend
        scale={only.scale}
        label={names.get(only.id) === only.name ? only.valueLabel : names.get(only.id)}
        note={grouped.has(only.id) ? AVERAGED : undefined}
      />
    );
  const more = Math.max(0, entries.length - MAX_ENTRIES);
  return (
    <div
      role="group"
      aria-label="Legend"
      data-map-legend={list ? "list" : "open"}
      className={`${LEGEND_BOX} relative flex max-h-full max-w-48 flex-col overflow-y-auto ${compact ? `w-max min-w-40 ${list ? "pr-5" : ""}` : "w-48"}`}
    >
      {list &&
        (compact ? (
          <button
            type="button"
            aria-expanded
            aria-label="Legend"
            title="Hide the legend"
            onClick={toggle}
            className={`absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover ${FOCUS}`}
          >
            <Icon id="chevron-down" className="size-3" />
          </button>
        ) : (
          <button
            type="button"
            aria-expanded
            title="Hide the legend"
            onClick={toggle}
            className={`-mx-1 flex shrink-0 items-center justify-between gap-2 rounded px-1 font-medium text-ds-text-heading hover:bg-general-bg-primary-hover ${FOCUS}`}
          >
            Legend
            <Icon id="chevron-down" className="size-3 text-general-label" />
          </button>
        ))}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((layer) => (
          <li key={layer.id} className="min-w-0">
            <LegendEntry
              layer={layer}
              name={names.get(layer.id) ?? layer.name}
              averaged={grouped.has(layer.id)}
            />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <div className="mt-1 text-ds-text-caption">
          {`+${more} more layer${more === 1 ? "" : "s"}`}
        </div>
      )}
      {categories.length > 0 && (
        <div className={entries.length ? "mt-1" : undefined}>
          <MapCategoryKey
            label={categoryLabel}
            categories={categories}
            compact={compact}
          />
        </div>
      )}
      {keys.length > 0 && (
        <div className={entries.length || categories.length ? "mt-1" : undefined}>
          <LegendKeys keys={keys} />
        </div>
      )}
    </div>
  );
});

export default MapLegends;
