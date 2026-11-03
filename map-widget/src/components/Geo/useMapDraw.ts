import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DrawnShape, mapShapes } from "~/lib/geo/mapShapes";
import type { DrawMode, DrawTool } from "./draw/drawTool";
import type { DrawDraft } from "./shapeLayers";

export const SHAPES_STORE_MS = 300;

export const loadDrawTool = () => import("./draw/drawTool");

export function useMapDraw({
  map,
  stored,
  onChange,
}: {
  map: MapLibreMap | null;
  stored: unknown;
  onChange?: (shapes: DrawnShape[]) => void;
}) {
  const kept = useMemo(() => mapShapes(stored), [stored]);
  const keptText = useMemo(() => JSON.stringify(kept), [kept]);
  const [shapes, setShapes] = useState(kept);
  const [rested, setRested] = useState(kept);
  const holding = useRef(false);
  const latest = useRef(kept);
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keeper = useRef(onChange);
  keeper.current = onChange;
  const handed = useRef(keptText);

  const flush = useCallback(() => {
    if (!waiting.current) return;
    clearTimeout(waiting.current);
    waiting.current = null;
    const reduced = mapShapes(latest.current);
    handed.current = JSON.stringify(reduced);
    keeper.current?.(reduced);
  }, []);
  useEffect(() => {
    if (keptText === handed.current || waiting.current) return;
    handed.current = keptText;
    latest.current = kept;
    setShapes(kept);
    setRested(kept);
  }, [keptText, kept]);
  useEffect(() => flush, [flush]);

  const change = useCallback(
    (next: DrawnShape[]) => {
      latest.current = next;
      setShapes(next);
      if (!holding.current) setRested(next);
      if (!keeper.current) return;
      if (waiting.current) clearTimeout(waiting.current);
      waiting.current = setTimeout(flush, SHAPES_STORE_MS);
    },
    [flush],
  );

  const [opened, setOpen] = useState<false | "draw" | "measure">(false);
  const [mode, setModeState] = useState<DrawMode>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<DrawDraft | null>(null);
  const tool = useRef<DrawTool | null>(null);
  const now = useRef({ mode, selected });
  now.current = { mode, selected };
  const can = Boolean(onChange);
  const open = opened === "draw" ? can : opened === "measure";

  useEffect(() => {
    if (!open || !map) return;
    let gone = false;
    let made: DrawTool | null = null;
    loadDrawTool().then(
      ({ startDrawTool }) => {
        if (gone) return;
        made = startDrawTool({
          map,
          shapes: () => latest.current,
          onShapes: (next) => {
            if (keeper.current) change(next);
          },
          onDraft: setDraft,
          onSelect: setSelected,
          onMode: setModeState,
          onLeave: () => setOpen(false),
          onHold: (held) => {
            holding.current = held;
            if (!held) setRested(latest.current);
          },
        });
        tool.current = made;
        made.setMode(now.current.mode);
        if (now.current.mode === "select") made.select(now.current.selected);
      },
      () => !gone && setOpen(false),
    );
    return () => {
      gone = true;
      made?.stop();
      tool.current = null;
      setDraft(null);
      flush();
    };
  }, [open, map, change, flush]);

  const setMode = useCallback((next: DrawMode) => {
    setModeState(next);
    if (next !== "select") setSelected(null);
    tool.current?.setMode(next);
  }, []);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    tool.current?.select(id);
  }, []);
  const toggle = useCallback(() => {
    setOpen((before) => (before === "draw" ? false : "draw"));
    setModeState("select");
    setSelected(null);
  }, []);
  const toggleMeasure = useCallback(() => {
    setOpen((before) => (before === "measure" ? false : "measure"));
    setModeState("distance");
    setSelected(null);
  }, []);
  const keepMeasure = useCallback(() => {
    if (tool.current?.keepMeasure()) setOpen("draw");
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setSelected(null);
  }, []);
  const update = useCallback(
    (id: string, patch: Partial<Pick<DrawnShape, "name" | "color" | "note">>) => {
      change(
        latest.current.map((shape) => {
          if (shape.id !== id) return shape;
          const next = { ...shape, ...patch };
          for (const key of ["name", "color", "note"] as const)
            if (!next[key]) delete next[key];
          return next;
        }),
      );
    },
    [change],
  );
  const remove = useCallback(
    (id: string) => {
      change(latest.current.filter((shape) => shape.id !== id));
      setSelected((before) => (before === id ? null : before));
      tool.current?.select(null);
    },
    [change],
  );
  const finish = useCallback(() => tool.current?.finish(), []);
  const cancel = useCallback(() => tool.current?.cancel(), []);

  return useMemo(
    () => ({
      shapes,
      rested,
      can,
      open: opened === "draw" && can,
      measuring: opened === "measure",
      mode,
      selected: open ? selected : null,
      draft: open ? draft : null,
      toggle,
      toggleMeasure,
      keepMeasure,
      close,
      setMode,
      select,
      update,
      remove,
      finish,
      cancel,
    }),
    [
      shapes,
      rested,
      can,
      opened,
      open,
      mode,
      selected,
      draft,
      toggle,
      toggleMeasure,
      keepMeasure,
      close,
      setMode,
      select,
      update,
      remove,
      finish,
      cancel,
    ],
  );
}

export type MapDraw = ReturnType<typeof useMapDraw>;
