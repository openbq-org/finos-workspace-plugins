import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useState,
} from "react";
import Icon from "~/components/Icon";
import { LayerSwatch } from "./LayerSwatch";
import { OPACITY_STEP } from "./layerPanelState";
import { FOCUS, RANGE } from "./mapControlStyles";
import type { SceneLayer } from "./sceneLayer";

const SWITCH = `flex size-5 shrink-0 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover disabled:text-general-label-disabled disabled:hover:bg-transparent ${FOCUS}`;

export const ShowSwitch = memo(function ShowSwitch({
  label,
  on,
  disabled = false,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={SWITCH}
      aria-label={label}
      aria-pressed={on}
      title={on ? "Shown: click to hide" : "Hidden: click to show"}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon id={on ? "eye-opened-icon" : "eye-closed-icon"} className="size-3.5" />
    </button>
  );
});

const moved = (key: string, percent: number): number | null => {
  if (key === "ArrowLeft" || key === "ArrowDown") return percent - OPACITY_STEP;
  if (key === "ArrowRight" || key === "ArrowUp") return percent + OPACITY_STEP;
  if (key === "Home") return 0;
  if (key === "End") return 100;
  return null;
};

export const LayerPanelRow = memo(function LayerPanelRow({
  layer,
  on,
  percent,
  compact,
  grouped,
  onGroup,
  farOut = false,
  onToggle,
  onOpacity,
}: {
  layer: SceneLayer;
  on: boolean;
  grouped?: boolean;
  onGroup?: (layer: SceneLayer, on: boolean) => void;
  percent: number;
  compact: boolean;
  farOut?: boolean;
  onToggle: (layer: SceneLayer) => void;
  onOpacity: (layer: SceneLayer, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => onToggle(layer), [onToggle, layer]);
  const flip = useCallback(() => setOpen((before) => !before), []);
  const regroup = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onGroup?.(layer, event.target.checked),
    [onGroup, layer],
  );
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onOpacity(layer, Number(event.target.value) / 100),
    [onOpacity, layer],
  );
  const onKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const next = moved(event.key, percent);
      if (next === null) return;
      event.preventDefault();
      onOpacity(layer, Math.min(100, Math.max(0, next)) / 100);
    },
    [onOpacity, layer, percent],
  );
  const drawn = !layer.note;
  return (
    <li className="px-2 py-0.5">
      <div className="flex h-5 items-center gap-1.5">
        <ShowSwitch
          label={`Show ${layer.name}`}
          on={drawn && on}
          disabled={!drawn}
          onToggle={toggle}
        />
        <LayerSwatch layer={layer} />
        <span
          title={layer.name}
          className={`min-w-0 flex-1 truncate ${drawn && on ? "text-ds-text-heading" : "text-ds-text-caption"}`}
        >
          {layer.name}
        </span>
        {layer.count > 0 && (
          <span className="shrink-0 tabular-nums text-ds-text-caption">
            {layer.count.toLocaleString("en-US")}
          </span>
        )}
        {compact && drawn && (
          <button
            type="button"
            aria-label={`Set opacity of ${layer.name}`}
            aria-expanded={open}
            title="Opacity"
            onClick={flip}
            className={`h-5 w-9 shrink-0 rounded text-right tabular-nums text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover ${FOCUS}`}
          >
            {`${percent}%`}
          </button>
        )}
      </div>
      {drawn && (!compact || open) && (
        <div className="flex h-4 items-center gap-1.5 pl-[26px]">
          <input
            type="range"
            min={0}
            max={100}
            step={OPACITY_STEP}
            value={percent}
            onChange={change}
            onKeyDown={onKey}
            aria-label={`Opacity of ${layer.name}`}
            aria-valuetext={`${percent}%`}
            className={RANGE}
          />
          {!compact && (
            <span className="w-8 shrink-0 text-right tabular-nums text-ds-text-caption">
              {`${percent}%`}
            </span>
          )}
        </div>
      )}
      {drawn && grouped !== undefined && (
        <label className="flex h-5 cursor-pointer items-center gap-1.5 pl-[26px] text-ds-text-body">
          <input
            type="checkbox"
            checked={grouped}
            onChange={regroup}
            className={`size-3 shrink-0 accent-brand-main ${FOCUS}`}
          />
          <span title="Points that lie on each other are one circle with their number. Zoom in to split it.">
            Group close points
          </span>
        </label>
      )}
      {layer.note && (
        <p className="m-0 pb-0.5 pl-[26px] text-ds-text-caption">{layer.note}</p>
      )}
      {!layer.note && on && farOut && (
        <p className="m-0 pb-0.5 pl-[26px] text-ds-text-caption">
          From zoom {layer.from}: zoom in to see it
        </p>
      )}
    </li>
  );
});
