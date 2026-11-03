import { cleanup } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { expect, vi } from "vitest";

type Handler = (event: never) => void;

export interface DrawnFeature {
  layer: { id: string };
  properties: Record<string, unknown>;
  geometry?: { type: string; coordinates?: unknown };
}

export interface CameraTo {
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  duration?: number;
}
export type CameraBox = [[number, number], [number, number]];
export interface CameraFit extends CameraTo {
  padding: { top: number; bottom: number; left: number; right: number };
  maxZoom: number;
}

export class FakeMap {
  static made: FakeMap[] = [];
  static fails = false;
  static shows: [number, number, number, number] | null = null;
  static reset() {
    FakeMap.made = [];
    FakeMap.fails = false;
    FakeMap.shows = null;
  }
  static misused(): string[] {
    return FakeMap.made.flatMap((map) => map.usedAfterRemove);
  }
  static last(): FakeMap {
    const map = FakeMap.made.at(-1);
    if (!map) throw new Error("No map was made.");
    return map;
  }

  readonly handlers = new Map<string, Set<Handler>>();
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly options: Record<string, unknown>;
  readonly styles: { sources: Record<string, unknown>; layers: { id: string }[] }[] =
    [];
  readonly styleOptions: ({ diff?: boolean } | undefined)[] = [];
  private diffed = false;
  removed = false;
  readonly usedAfterRemove: string[] = [];
  private layersLoaded = new Set<string>();
  private styleReady = false;
  readonly addedSources = new Map<string, unknown>();
  addedLayers: { layer: { id: string }; before?: string }[] = [];
  bounds: [number, number, number, number] = FakeMap.shows ?? [-180, -85, 180, 85];
  glyphs: string | undefined;
  private ready = false;
  repaints = 0;
  center: [number, number] = [0, 0];
  bearing = 0;
  pitch = 0;
  drawn: DrawnFeature[] = [];
  queries = 0;
  zoom = 3;
  maxZoom = 22;
  origin = { x: 0, y: 0 };

  readonly remove = vi.fn(() => {
    this.removed = true;
    this.canvas.remove();
    this.fire("remove");
  });
  private live(call: string) {
    if (!this.removed) return;
    this.usedAfterRemove.push(call);
    throw new Error(`${call}() was called on a map after remove().`);
  }
  readonly setMaxZoom = vi.fn((zoom: number) => {
    this.live("setMaxZoom");
    this.maxZoom = zoom;
  });
  readonly setMaxPitch = vi.fn(() => this.live("setMaxPitch"));
  readonly setFilter = vi.fn((..._given: unknown[]) => this.live("setFilter"));
  readonly setLayoutProperty = vi.fn((..._given: unknown[]) =>
    this.live("setLayoutProperty"),
  );
  readonly setPaintProperty = vi.fn((..._given: unknown[]) =>
    this.live("setPaintProperty"),
  );
  readonly fitBounds = vi.fn((_box: CameraBox, _to: CameraFit) =>
    this.live("fitBounds"),
  );
  readonly jumpTo = vi.fn((_to: CameraTo) => this.live("jumpTo"));
  readonly easeTo = vi.fn((_to: CameraTo) => this.live("easeTo"));
  readonly resize = vi.fn(() => this.live("resize"));
  readonly setData = vi.fn((..._given: unknown[]) => this.live("setData"));
  readonly setClusterOptions = vi.fn((..._given: unknown[]) =>
    this.live("setClusterOptions"),
  );
  readonly expansionZoom = vi.fn(async (_id: number) => 9);
  readonly cooperativeGestures = { enable: vi.fn(), disable: vi.fn() };
  readonly gestures = { dragRotate: false, doubleClickZoom: true, dragPan: true };
  private gesture(name: keyof FakeMap["gestures"]) {
    return {
      enable: vi.fn(() => {
        this.live(`${name}.enable`);
        this.gestures[name] = true;
      }),
      disable: vi.fn(() => {
        this.live(`${name}.disable`);
        this.gestures[name] = false;
      }),
      isEnabled: () => this.gestures[name],
    };
  }
  readonly dragRotate = this.gesture("dragRotate");
  readonly doubleClickZoom = this.gesture("doubleClickZoom");
  readonly dragPan = this.gesture("dragPan");
  readonly touchPitch = { enable: vi.fn(), disable: vi.fn() };
  readonly touchZoomRotate = { enableRotation: vi.fn(), disableRotation: vi.fn() };
  readonly keyboard = { enableRotation: vi.fn(), disableRotation: vi.fn() };

  constructor(options: Record<string, unknown> = {}) {
    if (FakeMap.fails) throw new Error("Failed to initialize WebGL.");
    this.options = options;
    this.container =
      (options.container as HTMLElement | undefined) ?? document.createElement("div");
    Object.defineProperties(this.container, {
      clientWidth: { value: 900, configurable: true },
      clientHeight: { value: 500, configurable: true },
    });
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.container.appendChild(this.canvas);
    FakeMap.made.push(this);
  }

  on(type: string, handler: Handler) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler);
    this.handlers.set(type, set);
    return this;
  }
  off(type: string, handler: Handler) {
    this.handlers.get(type)?.delete(handler);
    return this;
  }
  fire(type: string, event: object = {}) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event as never);
  }
  listeners(type?: string): number {
    if (type !== undefined) return this.handlers.get(type)?.size ?? 0;
    let count = 0;
    for (const set of this.handlers.values()) count += set.size;
    return count;
  }

  getContainer() {
    return this.container;
  }
  getCanvas() {
    return this.canvas;
  }
  getZoom() {
    return this.zoom;
  }
  getMaxZoom() {
    return this.maxZoom;
  }
  getMinZoom() {
    return 0;
  }
  fitZoom = 10;
  readonly cameraForBounds = vi.fn((box: CameraBox | readonly number[]) => {
    const [west, south, east, north] = box.flat() as number[];
    return { center: [(west + east) / 2, (south + north) / 2], zoom: this.fitZoom };
  });
  setStyle(
    style: { sources?: Record<string, unknown>; layers?: { id: string }[] },
    options?: { diff?: boolean },
  ) {
    this.live("setStyle");
    this.diffed = this.styles.length > 0 && options?.diff !== false;
    this.styles.push({ sources: style.sources ?? {}, layers: style.layers ?? [] });
    this.styleOptions.push(options);
    this.ready = false;
    this.glyphs = (style as { glyphs?: string }).glyphs;
    if (!this.diffed) {
      this.styleReady = false;
      this.addedSources.clear();
      this.addedLayers = [];
    }
    if (this.diffed)
      this.layersLoaded = new Set((style.layers ?? []).map((layer) => layer.id));
    else this.layersLoaded = new Set();
  }
  loaded() {
    return this.ready;
  }
  settle() {
    this.loadStyle();
    this.ready = true;
    this.fire("idle");
  }
  triggerRepaint() {
    this.live("triggerRepaint");
    this.repaints += 1;
    this.fire("render");
  }
  getCenter() {
    return { lng: this.center[0], lat: this.center[1] };
  }
  getBearing() {
    return this.bearing;
  }
  getPitch() {
    return this.pitch;
  }
  loadStyle() {
    this.layersLoaded = new Set(
      (this.styles.at(-1)?.layers ?? []).map((layer) => layer.id),
    );
    this.styleReady = true;
    this.fire(this.diffed ? "styledata" : "style.load");
  }
  getLayer(id: string) {
    this.live("getLayer");
    return this.layersLoaded.has(id) ? { id } : undefined;
  }
  getStyle() {
    this.live("getStyle");
    if (!this.styleReady) return undefined;
    return {
      ...this.styles.at(-1),
      layers: [
        ...(this.styles.at(-1)?.layers ?? []),
        ...this.addedLayers.map(({ layer }) => layer),
      ],
    };
  }
  private styled(call: string) {
    this.live(call);
    if (!this.styleReady) throw new Error("Style is not done loading.");
  }
  addSource(id: string, source: unknown) {
    this.styled("addSource");
    this.addedSources.set(id, source);
  }
  removeSource(id: string) {
    this.styled("removeSource");
    this.addedSources.delete(id);
  }
  addLayer(layer: { id: string }, before?: string) {
    this.styled("addLayer");
    this.addedLayers.push({ layer, ...(before === undefined ? {} : { before }) });
    this.layersLoaded.add(layer.id);
  }
  removeLayer(id: string) {
    this.styled("removeLayer");
    this.addedLayers = this.addedLayers.filter(({ layer }) => layer.id !== id);
    this.layersLoaded.delete(id);
  }
  getGlyphs() {
    return this.glyphs;
  }
  setGlyphs(url: string) {
    this.live("setGlyphs");
    this.glyphs = url;
  }
  getBounds() {
    const [west, south, east, north] = this.bounds;
    return {
      getWest: () => west,
      getSouth: () => south,
      getEast: () => east,
      getNorth: () => north,
    };
  }
  getSource(id: string) {
    this.live("getSource");
    return this.styles.at(-1)?.sources[id] || this.addedSources.has(id)
      ? {
          setData: (data: unknown) => this.setData(id, data),
          setClusterOptions: (options: unknown) => this.setClusterOptions(id, options),
          getClusterExpansionZoom: this.expansionZoom,
        }
      : undefined;
  }
  project([lon, lat]: [number, number]) {
    this.live("project");
    return { x: lon * 10 + this.origin.x, y: -lat * 10 + this.origin.y };
  }
  queryRenderedFeatures(first?: unknown, second?: { layers?: string[] }) {
    this.live("queryRenderedFeatures");
    this.queries += 1;
    const options = (second ?? first) as { layers?: string[] } | undefined;
    const layers = options?.layers;
    return this.drawn.filter((item) => !layers || layers.includes(item.layer.id));
  }

  get map(): MapLibreMap {
    return this as unknown as MapLibreMap;
  }
}

export const fakeLibrary = () =>
  ({
    Map: FakeMap,
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
  }) as unknown as typeof import("maplibre-gl");

export const pointerAt = (x: number, y: number) => ({
  point: { x, y },
  lngLat: { lng: x / 10, lat: -y / 10 },
});

export function expectNoUseAfterRemove() {
  cleanup();
  expect(FakeMap.misused()).toEqual([]);
}
