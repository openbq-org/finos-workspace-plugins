import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "~/components/Icon";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import {
  DRAWN_COLORS,
  type DrawnShape,
  enclosing,
  kindWord,
  shapeName,
} from "~/lib/geo/mapShapes";
import { measureOf, shapeMeasure } from "~/lib/geo/measure";
import { FOCUS } from "../mapControlStyles";
import {
  DrawAreaIcon,
  DrawCircleIcon,
  DrawLineIcon,
  DrawPointIcon,
  DrawRectangleIcon,
  DrawSelectIcon,
} from "../mapIcons";
import type { MapTheme } from "../mapTheme";
import type { MapDraw } from "../useMapDraw";
import type { DrawMode } from "./drawTool";
import MeasureReadout from "./MeasureReadout";

const BUTTON = `flex size-6 shrink-0 items-center justify-center text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover focus-visible:ring-inset disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS}`;
const ON = "bg-general-bg-primary-hover text-general-label-hover";

const MODES: {
  mode: DrawMode;
  label: string;
  hint: string;
  icon: typeof DrawPointIcon;
}[] = [
  {
    mode: "point",
    label: "Point",
    hint: "Click the map to place a point.",
    icon: DrawPointIcon,
  },
  {
    mode: "line",
    label: "Line",
    hint: "Click to place each corner. Double-click or Enter ends the line.",
    icon: DrawLineIcon,
  },
  {
    mode: "polygon",
    label: "Area",
    hint: "Click to place each corner. Double-click or Enter closes the area.",
    icon: DrawAreaIcon,
  },
  {
    mode: "rectangle",
    label: "Rectangle",
    hint: "Click one corner, then the corner across from it.",
    icon: DrawRectangleIcon,
  },
  {
    mode: "circle",
    label: "Circle",
    hint: "Click the centre, then a place on the circle.",
    icon: DrawCircleIcon,
  },
  {
    mode: "select",
    label: "Select and edit",
    hint: "Click a shape to select it. Drag a corner to move it.",
    icon: DrawSelectIcon,
  },
];

const MEASURES: typeof MODES = [
  {
    mode: "distance",
    label: "Measure a distance",
    hint: "Click to place each corner of a path. Double-click or Enter ends it.",
    icon: DrawLineIcon,
  },
  {
    mode: "area",
    label: "Measure an area",
    hint: "Click to place each corner of an area. Double-click or Enter closes it.",
    icon: DrawAreaIcon,
  },
];

export const INSIDE_RULE =
  "Points inside the shape; regions, areas and lines by their middle; flows with both ends inside.";

const MapDrawPanel = memo(function MapDrawPanel({
  draw,
  theme,
  inside,
  onInside,
  bottomRoom = 0,
}: {
  draw: MapDraw;
  theme: MapTheme;
  inside: readonly string[];
  onInside: (id: string, on: boolean) => void;
  bottomRoom?: number;
}) {
  const { mode, selected, shapes, setMode, remove, close, finish, measuring } = draw;
  const shape = useMemo(
    () => shapes.find((item) => item.id === selected),
    [shapes, selected],
  );
  const full = shapes.length >= MAP_LIMITS.drawnShapes;
  const modes = measuring ? MEASURES : MODES;
  const hint =
    full && !measuring
      ? `A map keeps ${MAP_LIMITS.drawnShapes} shapes: remove one to draw another.`
      : modes.find((item) => item.mode === mode)?.hint;
  const working = draw.draft?.shape;
  const live = useMemo(
    () =>
      working && (working.path.length > 1 || working.kind === "circle")
        ? measureOf(working.kind, working.path, working.radiusKm)
        : null,
    [working],
  );
  const ended = Boolean(draw.draft?.measured);
  const listed = useMemo(
    () => shapes.map((item) => ({ id: item.id, name: shapeName(item, shapes) })),
    [shapes],
  );
  const { select } = draw;
  const pick = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => select(event.target.value || null),
    [select],
  );
  const measured = useMemo(
    () => (shape ? <MeasureReadout measure={shapeMeasure(shape)} units /> : null),
    [shape],
  );
  const removeSelected = useCallback(() => {
    if (selected) remove(selected);
  }, [selected, remove]);
  const done = useCallback(() => {
    finish();
    close();
  }, [finish, close]);
  return (
    <>
      <div className="absolute right-10 top-2 z-20 flex max-w-[calc(100%-48px)] flex-col items-end gap-1">
        <div
          role="toolbar"
          aria-label={measuring ? "Measure" : "Draw"}
          data-map-draw
          className="flex divide-x divide-surface-divider overflow-hidden rounded border border-general-border-primary bg-general-bg-primary shadow-light-1"
        >
          {modes.map(({ mode: item, label, icon: Sign }) => (
            <button
              key={item}
              type="button"
              className={`${BUTTON} ${mode === item ? ON : ""}`}
              aria-label={label}
              aria-pressed={mode === item}
              title={label}
              disabled={full && !measuring && item !== "select"}
              onClick={() => setMode(item)}
            >
              <Sign className="size-3.5" />
            </button>
          ))}
          {measuring ? (
            draw.can && (
              <button
                type="button"
                className={`${BUTTON} w-auto px-1.5 text-xs font-medium`}
                title={
                  full
                    ? `A map keeps ${MAP_LIMITS.drawnShapes} shapes: remove one to keep another.`
                    : "Keep what was measured as a shape of the map"
                }
                disabled={!ended || full}
                onClick={draw.keepMeasure}
              >
                Keep as shape
              </button>
            )
          ) : (
            <button
              type="button"
              className={BUTTON}
              aria-label="Delete the selected shape"
              title="Delete the selected shape (Delete)"
              disabled={!shape}
              onClick={removeSelected}
            >
              <Icon id="trash-02" className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className={BUTTON}
            aria-label={measuring ? "Done measuring" : "Done drawing"}
            title="Done"
            onClick={measuring ? close : done}
          >
            <Icon id="check" className="size-3.5" />
          </button>
        </div>
        {live ? (
          <div
            role="status"
            aria-label="Measure"
            className="min-w-36 max-w-56 rounded border border-general-border-primary bg-general-bg-primary/95 px-2 py-1 shadow-light-1"
          >
            <MeasureReadout measure={live} units />
          </div>
        ) : (
          hint &&
          !shape && (
            <p
              role="status"
              className="m-0 max-w-56 rounded bg-general-bg-primary/90 px-1.5 py-0.5 text-right text-xs leading-4 text-ds-text-caption"
            >
              {hint}
            </p>
          )
        )}
        {!measuring && mode === "select" && listed.length > 0 && (
          <select
            aria-label="Select a shape"
            className={`${FIELD} w-auto max-w-56 shadow-light-1`}
            value={selected ?? ""}
            onChange={pick}
          >
            <option value="">Select a shape</option>
            {listed.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {shape && (
        <ShapeCard
          key={shape.id}
          shape={shape}
          name={shapeName(shape, shapes)}
          theme={theme}
          filters={inside.includes(shape.id)}
          onInside={onInside}
          onUpdate={draw.update}
          onRemove={remove}
          bottomRoom={bottomRoom}
        >
          {measured}
        </ShapeCard>
      )}
    </>
  );
});

export default MapDrawPanel;

const FIELD = `w-full rounded border border-general-border-primary bg-general-bg-primary px-1.5 py-0.5 text-xs leading-4 text-ds-text-heading placeholder:text-ds-text-caption ${FOCUS}`;

const COLOR_WORDS = ["Orange", "Teal", "Violet", "Pink", "Green", "Blue"];

export const ShapeCard = memo(function ShapeCard({
  shape,
  name,
  theme,
  filters,
  onInside,
  onUpdate,
  onRemove,
  bottomRoom = 0,
  children,
}: {
  shape: DrawnShape;
  name: string;
  theme: MapTheme;
  filters: boolean;
  onInside: (id: string, on: boolean) => void;
  onUpdate: MapDraw["update"];
  onRemove: (id: string) => void;
  bottomRoom?: number;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [typedName, setTypedName] = useState(shape.name ?? "");
  const [typedNote, setTypedNote] = useState(shape.note ?? "");
  const stored = useRef({ name: shape.name ?? "", note: shape.note ?? "" });
  useEffect(() => {
    if (stored.current.name !== (shape.name ?? "")) setTypedName(shape.name ?? "");
    if (stored.current.note !== (shape.note ?? "")) setTypedNote(shape.note ?? "");
    stored.current = { name: shape.name ?? "", note: shape.note ?? "" };
  }, [shape.name, shape.note]);
  const keepName = useCallback(() => {
    stored.current.name = typedName.trim();
    onUpdate(shape.id, { name: typedName });
  }, [onUpdate, shape.id, typedName]);
  const keepNote = useCallback(() => {
    stored.current.note = typedNote.trim();
    onUpdate(shape.id, { note: typedNote });
  }, [onUpdate, shape.id, typedNote]);
  const style = useMemo(
    () => ({ maxHeight: `calc(100% - ${44 + Math.max(24, bottomRoom + 28)}px)` }),
    [bottomRoom],
  );
  return (
    <section
      aria-label={`Shape ${name}`}
      data-map-shape-card
      style={style}
      className="absolute left-2 top-9 z-20 flex w-52 max-w-[calc(100%-56px)] flex-col gap-1.5 overflow-y-auto rounded border border-general-border-primary bg-general-bg-primary p-2 text-xs leading-4 text-ds-text-body shadow-light-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ds-text-heading">{kindWord(shape.kind)}</span>
        <button
          type="button"
          onClick={() => onRemove(shape.id)}
          className={`rounded px-1 text-ds-text-caption hover:text-ds-text-heading ${FOCUS}`}
        >
          Delete
        </button>
      </div>
      <label htmlFor={`${id}-name`} className="sr-only">
        Name
      </label>
      <input
        id={`${id}-name`}
        type="text"
        value={typedName}
        placeholder={name}
        maxLength={MAP_LIMITS.drawnNameChars}
        onChange={(event) => setTypedName(event.target.value)}
        onBlur={keepName}
        onKeyDown={(event) => {
          if (event.key === "Enter") keepName();
        }}
        className={FIELD}
      />
      {children}
      <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
        <legend className="sr-only">Colour</legend>
        {Array.from({ length: DRAWN_COLORS }, (_, at) => (
          <button
            key={at}
            type="button"
            aria-label={COLOR_WORDS[at]}
            aria-pressed={(shape.color ?? 0) === at}
            title={COLOR_WORDS[at]}
            onClick={() => onUpdate(shape.id, { color: at })}
            className={`flex size-5 items-center justify-center rounded-full border ${
              (shape.color ?? 0) === at
                ? "border-ds-text-heading"
                : "border-transparent hover:border-general-border-primary"
            } ${FOCUS}`}
          >
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: theme.series[at] }}
            />
          </button>
        ))}
      </fieldset>
      <label htmlFor={`${id}-note`} className="sr-only">
        Note
      </label>
      <textarea
        id={`${id}-note`}
        value={typedNote}
        rows={2}
        placeholder="Note"
        maxLength={MAP_LIMITS.drawnNoteChars}
        onChange={(event) => setTypedNote(event.target.value)}
        onBlur={keepNote}
        className={`${FIELD} resize-none`}
      />
      {enclosing(shape) && (
        <label className="flex cursor-pointer items-start gap-1.5" title={INSIDE_RULE}>
          <input
            type="checkbox"
            checked={filters}
            onChange={(event) => onInside(shape.id, event.target.checked)}
            className={`m-0 mt-0.5 size-3 shrink-0 cursor-pointer accent-brand-main ${FOCUS}`}
          />
          <span>
            Show only what is inside
            <span className="block text-ds-text-caption">{INSIDE_RULE}</span>
          </span>
        </label>
      )}
    </section>
  );
});
