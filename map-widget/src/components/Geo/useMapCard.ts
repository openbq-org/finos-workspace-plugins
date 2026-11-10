import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo } from "react";
import { type MapNotes, mapNotes } from "~/lib/geo/mapNotes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";
import { markNumbers } from "./markNumbers";
import type { Scene, SceneMark } from "./scene/sceneTypes";
import type { SceneLayer } from "./sceneLayer";
import { useMapPointer } from "./useMapPointer";

const NO_MARKS: readonly SceneMark[] = [];

export function useMapCard({
  map,
  scene,
  spec,
  expanded,
  shown,
  layers,
  notes,
  onNotesChange,
}: {
  map: MapLibreMap | null;
  scene: Scene | null;
  spec: MapSpec;
  expanded: boolean;
  shown: (mark: SceneMark) => boolean;
  layers: readonly SceneLayer[];
  notes: MapNotes;
  onNotesChange?: (notes: MapNotes) => void;
}) {
  const { hover, pinned, group, unpin, cardRef } = useMapPointer(
    map,
    scene,
    spec,
    expanded,
  );
  const cardIndex = pinned ?? hover;
  const cardMark = cardIndex !== null && scene ? scene.marks[cardIndex] : undefined;
  const groupMark = useMemo<SceneMark | undefined>(() => {
    if (!group) return undefined;
    const layer = layers.find((item) => item.id === group.layer);
    if (!layer) return undefined;
    return {
      kind: "point",
      layer: group.layer,
      at: group.at,
      label: `${group.count.toLocaleString("en-US")} places`,
      color: layer.color,
      ...(group.total === undefined
        ? {}
        : { props: { [`Sum of ${layer.sizeLabel ?? "size"}`]: group.total } }),
    };
  }, [group, layers]);
  const openMark =
    cardMark && shown(cardMark) ? cardMark : cardIndex === null ? groupMark : undefined;
  const openIndex = openMark && cardIndex !== null ? cardIndex : -1;
  const sizeLabel = useMemo(
    () => layers.find((layer) => layer.id === openMark?.layer)?.sizeLabel,
    [layers, openMark],
  );
  useEffect(() => {
    if (!map || !scene) return;
    for (const id of scene.hover)
      if (map.getLayer(id)) map.setFilter(id, ["==", ["get", "i"], openIndex]);
  }, [map, scene, openIndex]);

  const openKey = openMark?.key;
  const setNoteOf = useCallback(
    (key: string, text: string) => {
      if (!onNotesChange) return;
      const next = { ...notes };
      if (text.trim()) next[key] = text;
      else delete next[key];
      onNotesChange(mapNotes(next));
    },
    [notes, onNotesChange],
  );
  const setNote = useCallback(
    (text: string) => {
      if (openKey) setNoteOf(openKey, text);
    },
    [setNoteOf, openKey],
  );
  const valueLabel = useMemo(
    () => layers.find((layer) => layer.id === openMark?.layer)?.valueLabel,
    [layers, openMark],
  );
  const numbers = useMemo(() => markNumbers(scene?.marks ?? NO_MARKS), [scene]);
  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}
