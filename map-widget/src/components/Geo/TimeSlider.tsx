import {
  type ChangeEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import Icon from "~/components/Icon";
import { FOCUS, RANGE } from "./mapControlStyles";
import { PauseIcon, PlayIcon } from "./mapIcons";

export const FRAME_MS = 900;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const BUTTON = `flex size-5 shrink-0 items-center justify-center rounded text-general-label hover:bg-general-bg-primary-hover hover:text-general-label-hover disabled:text-general-label-disabled disabled:hover:bg-transparent ${FOCUS}`;
const BOX =
  "flex h-7 items-center gap-1.5 rounded border border-general-border-primary bg-general-bg-primary/95 px-1.5 text-xs leading-4 text-ds-text-body shadow-light-1";

const motionQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION)
    : null;
const watchMotion = (notify: () => void) => {
  const query = motionQuery();
  query?.addEventListener?.("change", notify);
  return () => query?.removeEventListener?.("change", notify);
};
const reducedMotion = () => motionQuery()?.matches ?? false;
const anyMotion = () => false;

interface TimeSliderProps {
  frames: readonly string[];
  frame: string;
  onFrame: (frame: string) => void;
  compact?: boolean;
  onPlaying?: (playing: boolean) => void;
}

const TimeSlider = memo(function TimeSlider({
  frames,
  frame,
  onFrame,
  compact = false,
  onPlaying,
}: TimeSliderProps) {
  const still = useSyncExternalStore(watchMotion, reducedMotion, anyMotion);
  const [wanted, setPlaying] = useState(false);
  const playing = wanted && !still;
  useEffect(() => {
    if (!playing) return;
    onPlaying?.(true);
    return () => onPlaying?.(false);
  }, [playing, onPlaying]);
  const last = frames.length - 1;
  const index = Math.max(0, frames.indexOf(frame));

  const go = useCallback(
    (to: number) => {
      const next = Math.min(last, Math.max(0, to));
      if (next >= last) setPlaying(false);
      if (frames[next] !== undefined && frames[next] !== frame) onFrame(frames[next]);
    },
    [frames, frame, last, onFrame],
  );
  useEffect(() => {
    if (!playing || index >= last) return;
    const timer = window.setTimeout(() => go(index + 1), FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, go]);
  useEffect(() => {
    if (!playing) return;
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", stop);
    return () => document.removeEventListener("visibilitychange", stop);
  }, [playing]);

  const play = useCallback(() => {
    if (playing) return setPlaying(false);
    if (index >= last && frames[0] !== undefined) onFrame(frames[0]);
    setPlaying(true);
  }, [playing, index, last, frames, onFrame]);
  const back = useCallback(() => go(index - 1), [go, index]);
  const forward = useCallback(() => go(index + 1), [go, index]);
  const slide = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => go(Number(event.target.value)),
    [go],
  );
  const onKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const to =
        event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? index - 1
          : event.key === "ArrowRight" || event.key === "ArrowUp"
            ? index + 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : null;
      if (to === null) return;
      event.preventDefault();
      go(to);
    },
    [go, index, last],
  );

  if (frames.length < 2) return null;
  const range = (
    <input
      type="range"
      min={0}
      max={last}
      step={1}
      value={index}
      onChange={slide}
      onKeyDown={onKey}
      aria-label="Time"
      aria-valuetext={frames[index]}
      className={RANGE}
    />
  );
  return (
    <div
      role="group"
      aria-label="Steps of time"
      data-map-time={compact ? "compact" : "wide"}
      className={`${BOX} w-full`}
    >
      {still ? (
        <button
          type="button"
          className={BUTTON}
          aria-label="Previous step"
          title="Previous step"
          disabled={index <= 0}
          onClick={back}
        >
          <Icon id="chevron-left" className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          className={BUTTON}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play the steps of time"}
          onClick={play}
        >
          {playing ? (
            <PauseIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </button>
      )}
      {range}
      {still && (
        <button
          type="button"
          className={BUTTON}
          aria-label="Next step"
          title="Next step"
          disabled={index >= last}
          onClick={forward}
        >
          <Icon id="chevron-right" className="size-3.5" />
        </button>
      )}
      <span
        title={frames[index]}
        className="max-w-24 shrink-0 truncate text-right font-medium tabular-nums text-ds-text-heading"
      >
        {frames[index]}
      </span>
    </div>
  );
});

export default TimeSlider;
