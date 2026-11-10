import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DrawHost,
  type DrawTool,
  handlesOf,
  startDrawTool,
} from "~/components/Geo/draw/drawTool";
import type { DrawDraft } from "~/components/Geo/shapeLayers";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import { kmBetween } from "~/lib/geo/geodesy";
import { type DrawnShape, mapShapes } from "~/lib/geo/mapShapes";
import { FakeMap, pointerAt } from "../fakeMap";

let map: FakeMap;
let shapes: DrawnShape[];
let draft: DrawDraft | null;
let selected: string | null;
let left: number;
let tool: DrawTool;
const host = (): DrawHost => ({
  map: map.map,
  shapes: () => shapes,
  onShapes: (next) => {
    shapes = next;
  },
  onDraft: (next) => {
    draft = next;
  },
  onSelect: (id) => {
    selected = id;
  },
  onMode: vi.fn(),
  onLeave: () => {
    left += 1;
  },
});
const click = (lon: number, lat: number) =>
  map.fire("click", pointerAt(lon * 10, -lat * 10));
const move = (lon: number, lat: number) =>
  map.fire("mousemove", pointerAt(lon * 10, -lat * 10));
const key = (name: string, more: KeyboardEventInit = {}) =>
  map.container.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: name,
      bubbles: true,
      cancelable: true,
      ...more,
    }),
  );

beforeEach(() => {
  FakeMap.reset();
  map = new FakeMap();
  shapes = [];
  draft = null;
  selected = null;
  left = 0;
  tool = startDrawTool(host());
});
afterEach(() => tool.stop());

describe("drawing a shape", () => {
  it("places a point at the first click, and selects it", () => {
    tool.setMode("point");
    click(2.35, 48.85);
    expect(shapes).toEqual([
      {
        id: "shape-1",
        kind: "point",
        geometry: { type: "Point", coordinates: [2.35, 48.85] },
      },
    ]);
    expect(selected).toBe("shape-1");
  });

  it("draws a line click by click and ends it at Enter", () => {
    tool.setMode("line");
    click(0, 0);
    click(5, 0);
    move(5, 5);
    expect(draft?.path).toEqual([
      [0, 0],
      [5, 0],
      [5, 5],
    ]);
    click(5, 5);
    key("Enter");
    expect(shapes[0]).toMatchObject({
      kind: "line",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
      },
    });
  });

  it("closes an area at a double click, whose second click adds no corner", () => {
    tool.setMode("polygon");
    click(0, 0);
    click(10, 0);
    click(10, 10);
    click(10, 10);
    map.fire("dblclick", { ...pointerAt(100, -100), preventDefault: vi.fn() });
    expect(shapes[0].geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    });
  });

  it("closes an area at a click on its first corner", () => {
    tool.setMode("polygon");
    click(0, 0);
    click(10, 0);
    click(10, 10);
    click(0.2, 0.1);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].geometry.coordinates[0]).toHaveLength(4);
  });

  it("ends nothing that is no shape yet: a line of one position, an area of two", () => {
    tool.setMode("line");
    click(0, 0);
    expect(tool.finish()).toBe(false);
    tool.setMode("polygon");
    click(0, 0);
    click(1, 1);
    key("Enter");
    expect(shapes).toEqual([]);
  });

  it("makes a rectangle of two corners and a circle of its centre and a place on it", () => {
    tool.setMode("rectangle");
    click(0, 0);
    click(4, 3);
    expect(shapes[0]).toMatchObject({ kind: "rectangle" });
    expect(shapes[0].geometry.coordinates).toEqual([
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ],
    ]);
    tool.setMode("circle");
    click(2, 48);
    move(3, 48);
    const far = kmBetween([2, 48], [3, 48]);
    for (const place of draft?.path ?? [])
      expect(kmBetween([2, 48], place)).toBeCloseTo(far, 6);
    click(3, 48);
    expect(shapes[1]).toMatchObject({
      kind: "circle",
      geometry: { type: "Point", coordinates: [2, 48] },
    });
    expect(shapes[1].radiusKm).toBeCloseTo(far, 6);
    expect(mapShapes(shapes)).toHaveLength(2);
  });

  it("gives up the shape that is being drawn at Escape, and takes the last position back with Ctrl or Cmd and Z", () => {
    tool.setMode("line");
    click(0, 0);
    click(1, 0);
    click(2, 0);
    key("z", { ctrlKey: true });
    expect(draft?.path).toHaveLength(2);
    key("z", { metaKey: true });
    expect(draft?.handles).toEqual([[0, 0]]);
    key("Escape");
    expect(draft).toBeNull();
    key("Enter");
    expect(shapes).toEqual([]);
    expect(left).toBe(0);
    key("Escape");
    expect(left).toBe(1);
  });

  it("writes a path over the 180th meridian without a jump, from a first position on the map", () => {
    tool.setMode("line");
    click(170, 0);
    click(-170, 0);
    key("Enter");
    expect(shapes[0].geometry.coordinates).toEqual([
      [170, 0],
      [190, 0],
    ]);
    tool.setMode("point");
    click(190, 0);
    expect(shapes[1].geometry.coordinates).toEqual([-170, 0]);
  });

  it("takes no more shapes than a map keeps, and no more positions than a shape has", () => {
    shapes = Array.from({ length: MAP_LIMITS.drawnShapes }, (_, at) => ({
      id: `s${at}`,
      kind: "point",
      geometry: { type: "Point", coordinates: [0, 0] },
    }));
    tool.setMode("point");
    click(1, 1);
    expect(shapes).toHaveLength(MAP_LIMITS.drawnShapes);
    shapes = [];
    tool.setMode("line");
    for (let at = 0; at < MAP_LIMITS.drawnVertices + 20; at++) click(at / 10, at % 2);
    key("Enter");
    expect(shapes[0].geometry.coordinates.length).toBeLessThan(
      MAP_LIMITS.drawnVertices,
    );
    expect(mapShapes(shapes)).toHaveLength(1);
  });
});

describe("measuring without keeping a shape", () => {
  it("says what is being drawn as it grows: its kind and its positions up to the pointer", () => {
    tool.setMode("distance");
    click(0, 0);
    move(1, 0);
    expect(draft?.shape).toEqual({
      kind: "line",
      path: [
        [0, 0],
        [1, 0],
      ],
    });
    tool.setMode("rectangle");
    click(0, 0);
    move(2, 1);
    expect(draft?.shape?.kind).toBe("rectangle");
    expect(draft?.shape?.path).toHaveLength(5);
    tool.setMode("circle");
    click(0, 0);
    move(1, 0);
    expect(draft?.shape).toMatchObject({ kind: "circle", path: [[0, 0]] });
    expect(draft?.shape?.radiusKm).toBeCloseTo(kmBetween([0, 0], [1, 0]), 6);
  });

  it("ends a distance and an area without a shape: the measure stays to be read, until Escape or the next click", () => {
    tool.setMode("distance");
    click(0, 0);
    click(1, 0);
    click(1, 1);
    key("Enter");
    expect(shapes).toEqual([]);
    expect(draft).toMatchObject({
      measured: true,
      shape: { kind: "line" },
      path: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    key("Escape");
    expect(draft).toBeNull();
    expect(left).toBe(0);

    tool.setMode("area");
    click(0, 0);
    click(2, 0);
    click(2, 2);
    click(0.1, 0.1);
    expect(draft?.measured).toBe(true);
    expect(draft?.shape?.path).toHaveLength(4);
    click(5, 5);
    expect(draft?.measured).toBeUndefined();
    expect(draft?.handles).toEqual([[5, 5]]);
    expect(shapes).toEqual([]);
  });

  it("keeps the measure that was ended as a shape when the reader asks, and selects it", () => {
    tool.setMode("area");
    click(0, 0);
    click(2, 0);
    click(2, 2);
    expect(tool.keepMeasure()).toBe(false);
    key("Enter");
    expect(tool.keepMeasure()).toBe(true);
    expect(shapes).toEqual([
      {
        id: "shape-1",
        kind: "polygon",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    expect(selected).toBe("shape-1");
    expect(tool.keepMeasure()).toBe(false);
  });
});

describe("selecting and changing a shape", () => {
  beforeEach(() => {
    shapes = mapShapes([
      {
        id: "a",
        kind: "polygon",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
      },
      { id: "p", kind: "point", geometry: { type: "Point", coordinates: [30, 30] } },
      {
        id: "r",
        kind: "rectangle",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [20, 0],
              [24, 0],
              [24, 3],
              [20, 3],
              [20, 0],
            ],
          ],
        },
      },
      {
        id: "c",
        kind: "circle",
        geometry: { type: "Point", coordinates: [-40, 0] },
        radiusKm: 300,
      },
    ]);
    tool.setMode("select");
  });

  it("selects the shape under a click, inside an area or beside a point, and none on empty ground", () => {
    click(5, 5);
    expect(selected).toBe("a");
    expect(draft?.handles).toHaveLength(4);
    click(30.5, 30.2);
    expect(selected).toBe("p");
    click(60, -60);
    expect(selected).toBeNull();
    expect(draft).toBeNull();
  });

  it("moves the corner that is pressed, and holds the map still for as long as it is held", () => {
    click(5, 5);
    const prevented = vi.fn();
    map.fire("mousedown", { ...pointerAt(100, -100), preventDefault: prevented });
    expect(prevented).toHaveBeenCalled();
    expect(map.gestures.dragPan).toBe(false);
    move(12, 14);
    expect(shapes[0].geometry.coordinates[0]).toEqual([
      [0, 0],
      [10, 0],
      [12, 14],
      [0, 10],
      [0, 0],
    ]);
    map.fire("mouseup");
    expect(map.gestures.dragPan).toBe(true);
    move(50, 50);
    expect(shapes[0].geometry.coordinates[0][2]).toEqual([12, 14]);
  });

  it("leaves the map to the reader where no corner is under the press", () => {
    click(5, 5);
    const prevented = vi.fn();
    map.fire("mousedown", { ...pointerAt(50, -50), preventDefault: prevented });
    expect(prevented).not.toHaveBeenCalled();
    expect(map.gestures.dragPan).toBe(true);
  });

  it("keeps a rectangle a rectangle, and sets the radius of a circle from the handle on its outline", () => {
    click(22, 1);
    map.fire("mousedown", pointerAt(240, -30));
    move(26, 5);
    map.fire("mouseup");
    expect(shapes[2].geometry.coordinates[0]).toEqual([
      [20, 0],
      [26, 0],
      [26, 5],
      [20, 5],
      [20, 0],
    ]);
    click(-40, 0.5);
    expect(selected).toBe("c");
    const [, rim] = handlesOf(shapes[3]);
    map.fire("mousedown", pointerAt(rim[0] * 10, -rim[1] * 10));
    move(-35, 0);
    map.fire("mouseup");
    expect(shapes[3].radiusKm).toBeCloseTo(kmBetween([-40, 0], [-35, 0]), 6);
    expect(shapes[3].geometry.coordinates).toEqual([-40, 0]);
  });

  it("keeps the corner across of a rectangle through every move of a held corner", () => {
    click(22, 1);
    map.fire("mousedown", pointerAt(200, 0));
    move(19, -1);
    move(18, -2);
    move(17, -3);
    map.fire("mouseup");
    expect(shapes[2].geometry.coordinates[0]).toEqual([
      [24, 3],
      [17, 3],
      [17, -3],
      [24, -3],
      [24, 3],
    ]);
  });

  it("lets a corner go when the button is released outside the canvas", () => {
    click(5, 5);
    map.fire("mousedown", pointerAt(100, -100));
    expect(map.gestures.dragPan).toBe(false);
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(map.gestures.dragPan).toBe(true);
    const before = shapes[0].geometry.coordinates;
    move(50, 50);
    expect(shapes[0].geometry.coordinates).toEqual(before);
  });

  it("removes the selected shape at Delete or Backspace, and nothing while a field has the key", () => {
    click(5, 5);
    const field = document.createElement("input");
    map.container.appendChild(field);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );
    expect(shapes).toHaveLength(4);
    key("Delete");
    expect(shapes.map((shape) => shape.id)).toEqual(["p", "r", "c"]);
    expect(selected).toBeNull();
  });

  it("works with a touch as with the pointer", () => {
    click(5, 5);
    map.fire("touchstart", { ...pointerAt(0, 0), preventDefault: vi.fn() });
    map.fire("touchmove", pointerAt(-10, 10));
    map.fire("touchend");
    expect(shapes[0].geometry.coordinates[0][0]).toEqual([-1, -1]);
    expect(map.gestures.dragPan).toBe(true);
  });
});

describe("the gestures of the map while the tool is on", () => {
  it("turns the zoom of a double click off and gives it back, with every listener it added", () => {
    expect(map.gestures.doubleClickZoom).toBe(false);
    const before = map.listeners();
    expect(before).toBeGreaterThan(0);
    tool.stop();
    expect(map.gestures.doubleClickZoom).toBe(true);
    expect(map.listeners()).toBe(0);
    expect(draft).toBeNull();
  });

  it("stops a map that can be turned from turning, and lets it turn again afterwards", () => {
    tool.stop();
    map.gestures.dragRotate = true;
    tool = startDrawTool(host());
    expect(map.gestures.dragRotate).toBe(false);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
    tool.stop();
    expect(map.gestures.dragRotate).toBe(true);
    expect(map.touchZoomRotate.enableRotation).toHaveBeenCalled();
  });

  it("leaves a flat map flat: it turns nothing on that was off", () => {
    tool.stop();
    expect(map.gestures.dragRotate).toBe(false);
    expect(map.touchZoomRotate.enableRotation).not.toHaveBeenCalled();
  });

  it("stops without a word when the map was removed first", () => {
    map.remove();
    expect(() => tool.stop()).not.toThrow();
    expect(FakeMap.misused()).toEqual([]);
  });
});
