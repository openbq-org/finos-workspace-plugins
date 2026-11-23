import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useResizeDetector } from "react-resize-detector";
import { displayNumber, numberKind } from "~/lib/utils/displayNumber";
import { gradientOf } from "./LayerSwatch";
import { FOCUS } from "./mapControlStyles";
import { type MapScale, shortNumber } from "./mapTheme";
import { noteHead } from "./mapWords";

export const LegendBar = memo(function LegendBar({
  label,
  detail,
  stops,
  low,
  middle,
  high,
}: {
  label?: string;
  detail?: string;
  stops: readonly string[];
  low: string;
  middle?: string;
  high?: string;
}) {
  return (
    <>
      {(label || detail) && (
        <div className="break-words font-medium text-ds-text-heading">
          {label}
          {detail && (
            <span className="block font-normal text-ds-text-caption">{detail}</span>
          )}
        </div>
      )}
      <div className="w-36 max-w-full">
        <div
          className="mt-0.5 h-2 rounded-sm"
          style={{ background: gradientOf(stops) }}
        />
        <div className="flex justify-between gap-3 tabular-nums">
          <span>{low}</span>
          {middle !== undefined && <span>{middle}</span>}
          {high !== undefined && <span>{high}</span>}
        </div>
      </div>
    </>
  );
});

export const scaleEnds = (scale: MapScale, label?: string) => {
  const kind = numberKind(label, [scale.min, scale.max]);
  const end = (value: number) =>
    displayNumber(value, { column: label, kind, quantity: shortNumber });
  return {
    stops: scale.stops,
    low: end(scale.min),
    middle: scale.diverging ? "0" : undefined,
    high: scale.min === scale.max ? undefined : end(scale.max),
  };
};

export const LEGEND_BOX =
  "max-w-full rounded border border-general-border-primary bg-general-bg-primary/95 px-2 py-1 text-xs leading-4 text-ds-text-body shadow-light-1";

export const MapBottom = memo(function MapBottom({
  compact,
  barRef,
  slider,
  legend,
  aside,
  notice,
}: {
  compact: boolean;
  barRef?: Ref<HTMLDivElement>;
  slider?: ReactNode;
  legend?: ReactNode;
  aside?: ReactNode;
  notice?: ReactNode;
}) {
  const BAR =
    "pointer-events-none absolute left-2 right-2 z-10 flex max-h-[calc(100%-56px)] [&_[data-map-part]]:pointer-events-auto";
  if (compact)
    return (
      <div
        ref={barRef}
        data-map-bottom="compact"
        className={`${BAR} bottom-6 flex-col gap-1.5`}
      >
        {slider && (
          <div data-map-part data-map-overlay>
            {slider}
          </div>
        )}
        {notice && (
          <div
            data-map-part
            data-map-overlay
            className="flex min-w-0 justify-end self-end max-w-full"
          >
            {notice}
          </div>
        )}
        <div className="flex min-h-0 items-end justify-between gap-2">
          <div data-map-part className="flex min-h-0 min-w-0 max-h-full">
            {legend}
          </div>
          {aside && (
            <div data-map-part data-map-overlay className="shrink-0">
              {aside}
            </div>
          )}
        </div>
      </div>
    );
  return (
    <div
      ref={barRef}
      data-map-bottom="wide"
      className={`${BAR} bottom-2 items-end gap-2`}
    >
      <div data-map-part className="flex max-h-full min-h-0 shrink-0">
        {legend}
      </div>
      {slider && (
        <div
          data-map-part
          data-map-overlay
          className="mb-4 min-w-40 max-w-[340px] flex-1"
        >
          {slider}
        </div>
      )}
      {(aside || notice) && (
        <div
          data-map-part
          data-map-overlay
          className="mb-5 ml-auto flex min-w-0 flex-col items-end gap-1"
        >
          {notice}
          {aside}
        </div>
      )}
    </div>
  );
});

export const MapLegend = memo(function MapLegend({
  scale,
  label,
  note,
}: {
  scale: MapScale;
  label?: string;
  note?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`Legend${label ? `: ${label}` : ""}`}
      data-map-legend="open"
      className={LEGEND_BOX}
    >
      <LegendBar label={label} {...scaleEnds(scale, label)} />
      {note && <div className="text-ds-text-caption">{note}</div>}
    </div>
  );
});

const CREDIT_BOX =
  "absolute bottom-1 right-1 z-10 rounded bg-general-bg-primary/80 px-1 text-2xs leading-4 text-ds-text-caption";
const NO_CREDITS: readonly string[] = [];
const CREDIT_LINK = `no-underline hover:text-ds-text-body ${FOCUS}`;

export const MapCredit = memo(function MapCredit({
  credit,
  sources,
  required,
}: {
  credit: string;
  sources?: readonly string[];
  required?: readonly string[];
}) {
  const named = useMemo(
    () => [...new Set((sources ?? []).filter((source) => source.trim()))],
    [sources],
  );
  const asked = required ?? NO_CREDITS;
  if (!named.length && !asked.length)
    return credit ? (
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        data-map-credit
        className={`${CREDIT_BOX} ${CREDIT_LINK}`}
      >
        {credit}
      </a>
    ) : null;
  return (
    <div
      data-map-credit
      className={`${CREDIT_BOX} flex items-center gap-1 ${
        asked.length ? "max-w-[calc(100%-8px)]" : "max-w-[calc(100%-208px)]"
      }`}
    >
      {asked.map((text, at) => (
        <span key={text} className="flex shrink-0 items-center gap-1">
          {at > 0 && <span aria-hidden>·</span>}
          <span className="shrink-0 whitespace-nowrap">{text}</span>
        </span>
      ))}
      {named.map((source, at) => (
        <span key={source} className="flex min-w-0 items-center gap-1">
          {(at > 0 || asked.length > 0) && <span aria-hidden>·</span>}
          <span title={source} className="max-w-40 min-w-0 truncate">
            {source}
          </span>
        </span>
      ))}
      {credit && (
        <>
          <span aria-hidden>·</span>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            title={credit}
            className={`min-w-0 truncate rounded ${CREDIT_LINK}`}
          >
            {credit}
          </a>
        </>
      )}
    </div>
  );
});

const NOTE_JOIN = " · ";

export const MapHeading = memo(function MapHeading({
  title,
  notes,
}: {
  title?: string;
  notes: readonly string[];
}) {
  const line = useMemo(() => notes.map(noteHead).join(NOTE_JOIN), [notes]);
  const whole = useMemo(() => notes.join("\n"), [notes]);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { ref: lineRef, width } = useResizeDetector<HTMLSpanElement>({
    handleHeight: false,
  });
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = lineRef.current;
    setCut(Boolean(element && element.scrollWidth > element.clientWidth));
  }, [lineRef, width, line]);
  const detailed = cut || line !== notes.join(NOTE_JOIN);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  const close = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }, []);
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-56px)] flex-col items-start text-xs leading-4">
      {title && (
        <div
          data-map-overlay
          className="max-w-full truncate rounded bg-general-bg-primary/90 px-1.5 py-0.5 font-medium text-ds-text-heading"
        >
          {title}
        </div>
      )}
      {notes.length > 0 && (
        <div
          data-map-overlay="line"
          className="mt-0.5 flex max-w-full items-center gap-1.5 rounded bg-general-bg-primary/90 px-1.5 py-0.5 text-ds-text-caption"
        >
          <span ref={lineRef} role="status" title={whole} className="min-w-0 truncate">
            {line}
          </span>
          {detailed && (
            <button
              ref={button}
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={toggle}
              onKeyDown={close}
              className={`pointer-events-auto shrink-0 rounded font-medium text-ds-text-body underline decoration-dotted underline-offset-2 hover:text-ds-text-heading ${FOCUS}`}
            >
              {open ? "Hide details" : "Details"}
            </button>
          )}
        </div>
      )}
      {open && detailed && (
        <section
          id={panelId}
          aria-label="Notes of the map"
          onKeyDown={close}
          className="pointer-events-auto mt-0.5 max-h-28 max-w-full overflow-y-auto rounded bg-general-bg-primary/95 px-1.5 py-1 text-ds-text-body"
        >
          {notes.map((note) => (
            <p key={note} className="m-0 select-text break-words [&+p]:mt-1">
              {note}
            </p>
          ))}
        </section>
      )}
    </div>
  );
});
