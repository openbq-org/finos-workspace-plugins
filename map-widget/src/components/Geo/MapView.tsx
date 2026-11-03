import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { mapSpec } from "~/lib/geo/mapSpec";
import MapCanvas, { type MapViewProps } from "./MapCanvas";
import MapFallback from "./MapFallback";
import MapPlaceholder from "./MapPlaceholder";
import { useMapSlot } from "./mapBudget";
import { canDrawMaps } from "./mapLibrary";
import { type MapStill, stillPool } from "./mapStill";
import { NO_WEBGL } from "./useLibraryMap";
import type { KeptCamera } from "./useMapCamera";
import type { KeptCrowd } from "./useMapCrowd";
import type { MapCanvasSlot } from "./useMapStill";

const NOT_DRAWN = "The map could not be drawn. The data of the map is in the table.";
export const CONTEXT_LOST =
  "The browser stopped drawing this map: its graphics context was lost. The data of the map is in the table.";

const STILL_RETRY_MS = 30_000;

const Message = ({ children }: { children: string }) => (
  <p role="alert" className="m-0 px-3 py-2 text-xs text-ds-text-body">
    {children}
  </p>
);

interface Attempt {
  count: number;

  failed: string | null;

  lost: boolean;
}
const FIRST: Attempt = { count: 0, failed: null, lost: false };

const MapView = memo(function MapView({
  spec,
  name,
  notes,
  onNotesChange,
  view,
  onViewChange,
  shapes,
  onShapesChange,
  expanded = false,
}: MapViewProps) {
  const checked = useMemo(() => {
    try {
      return { spec: mapSpec(spec) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [spec]);
  const drawable = useMemo(() => canDrawMaps(), []);
  const [attempt, setAttempt] = useState(FIRST);
  const fail = useCallback(
    (reason: string) => setAttempt((now) => ({ ...now, failed: reason })),
    [],
  );
  const contextLost = useCallback(
    () =>
      setAttempt((now) =>
        now.lost
          ? { ...now, failed: CONTEXT_LOST }
          : { count: now.count + 1, failed: null, lost: true },
      ),
    [],
  );

  const slot = useMapSlot(
    checked.error === undefined && drawable && attempt.failed === null,

    expanded,
  );
  const retry = useCallback(
    () => setAttempt((now) => ({ count: now.count + 1, failed: null, lost: false })),
    [],
  );
  const { setStill: saySlotStill, released, setPinned } = slot;
  const [still, setStill] = useState<MapStill | null>(null);
  const kept = useRef<MapStill | null>(null);

  const owner = useRef({}).current;

  const putStill = useCallback(
    (next: MapStill | null) => {
      if (kept.current) URL.revokeObjectURL(kept.current.url);
      kept.current = next;
      setStill(next);
      if (!next) return stillPool.forget(owner);

      stillPool.keep(owner, next.bytes, () => {
        putStill(null);
        saySlotStill(false);
      });
    },
    [owner, saySlotStill],
  );
  const again = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onStill = useCallback(
    (next: MapStill | null) => {
      if (next) {
        putStill(next);
        return saySlotStill(true);
      }

      saySlotStill(true);
      released();
      clearTimeout(again.current);
      again.current = setTimeout(() => saySlotStill(false), STILL_RETRY_MS);
    },
    [putStill, saySlotStill, released],
  );
  useEffect(
    () => () => {
      clearTimeout(again.current);
      if (kept.current) URL.revokeObjectURL(kept.current.url);
      kept.current = null;
      stillPool.forget(owner);
    },
    [owner],
  );
  const camera = useRef<KeptCamera | null>(null);
  const crowd = useRef<KeptCrowd | null>(null);
  const holding = slot.mode !== "none";
  const canvasSlot = useMemo<MapCanvasSlot>(
    () => ({
      live: holding,
      passing: slot.mode === "passing",
      still,
      onStill,
      onStillCurrent: saySlotStill,
      onReleased: released,
      onPlaying: setPinned,
      camera,
      crowd,
    }),
    [holding, slot.mode, still, onStill, saySlotStill, released, setPinned],
  );

  useEffect(() => {
    if (still && slot.near) stillPool.use(owner);
  }, [still, slot.near, owner]);
  const notDrawn = useCallback(() => fail(NOT_DRAWN), [fail]);

  const [local, setLocal] = useState<unknown>(view);
  if (checked.error !== undefined) return <Message>{checked.error}</Message>;
  if (!drawable)
    return <MapFallback spec={checked.spec} name={name} reason={NO_WEBGL} />;
  if (attempt.failed)
    return (
      <MapFallback
        spec={checked.spec}
        name={name}
        reason={attempt.failed}
        onRetry={retry}
      />
    );
  const title = checked.spec.title ?? name;
  return (
    <div ref={slot.ref} className="flex min-h-0 flex-1 flex-col">
      {holding || (slot.near && still) ? (
        <ErrorBoundary fallback={null} onError={notDrawn}>
          <MapCanvas
            key={attempt.count}
            spec={checked.spec}
            name={name}
            notes={notes}
            onNotesChange={onNotesChange}
            view={onViewChange ? view : local}
            onViewChange={onViewChange ?? setLocal}
            shapes={shapes}
            onShapesChange={onShapesChange}
            expanded={expanded}
            onFail={fail}
            onContextLost={contextLost}
            slot={canvasSlot}
            keepsCamera={Boolean(onViewChange)}
          />
        </ErrorBoundary>
      ) : still ? (

        <div role="img" aria-label={`Map ${title}`} className="relative min-h-0 flex-1">
          <div className="absolute inset-1 overflow-hidden rounded-sm">
            <img
              src={still.url}
              alt=""
              draggable={false}
              data-map-still
              style={still.shown}
              className="absolute left-0 top-0 max-w-none"
            />
          </div>
        </div>
      ) : (
        <MapPlaceholder title={title} loading={slot.near} />
      )}
    </div>
  );
});
export default MapView;
