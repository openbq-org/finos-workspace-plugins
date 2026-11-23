import type { MapNotes } from "~/lib/geo/mapNotes";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import type { MapSpec } from "~/lib/geo/mapSpecTypes";

export interface Model {
  get(name: string): any;
  set(name: string, value: unknown): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event?: string, callback?: (...args: any[]) => void): void;
  save_changes(): void;
}

export interface Shown {
  spec: MapSpec;
  name: string;
  notes: MapNotes;
  shapes: DrawnShape[];
  view: unknown;
}

export const MAX_STATE_BYTES = 64 * 1024;

let shown: Shown | null = null;

export const setShown = (next: Shown | null): void => {
  shown = next;
};

export const getShown = (): Shown | null => shown;
