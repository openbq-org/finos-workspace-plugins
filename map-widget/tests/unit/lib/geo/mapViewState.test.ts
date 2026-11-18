import { describe, expect, it } from "vitest";
import { MAP_LIMITS } from "~/lib/codemode/limits";
import {
  boxOfView,
  cameraBox,
  cameraIsOf,
  cameraWithBox,
  heldView,
  layerGrouped,
  layerOpacity,
  layerVisible,
  mapViewState,
  sameView,
} from "~/lib/geo/mapViewState";

describe("mapViewState", () => {
  it("keeps what a reader changed and nothing else", () => {
    const state = mapViewState({
      hidden: ["points", "ndvi", "points"],
      shown: ["heat-1", "ndvi"],
      opacity: { yield: 0.456, points: 1, bad: "0.5", low: -2 },
      basemap: { names: false, roads: false, borders: true, choice: "plain", url: "x" },
      frame: "2024",
      legend: "closed",
      panel: "open",
      style: "https://attacker.example/style.json",
    });
    expect(state).toEqual({
      hidden: ["points", "ndvi"],
      shown: ["heat-1"],
      opacity: { yield: 0.46, points: 1, low: 0 },
      basemap: { names: false, roads: false, borders: true, choice: "plain" },
      frame: "2024",
      legend: "closed",
      panel: "open",
    });
    expect(mapViewState(state)).toEqual(state);
  });

  it.each([null, undefined, 7, "x", [], [{ hidden: ["a"] }]])(
    "is empty for %j and never throws",
    (raw) => {
      expect(mapViewState(raw)).toEqual({});
    },
  );

  it("drops ids that are not of the grammar, and addresses", () => {
    const state = mapViewState({
      hidden: ["https://attacker.example", "A", "", 7, null, "ok"],
      opacity: JSON.parse(
        '{ "https://attacker.example": 0.5, "__proto__": 0.2, "_x": 0.3, "ok": 0.5 }',
      ),
      basemap: { choice: "https://attacker.example/{z}/{x}/{y}.png" },
      frame: "x".repeat(MAP_LIMITS.frameChars + 1),
      legend: "open",
    });
    expect(state).toEqual({ hidden: ["ok"], opacity: { ok: 0.5 } });
    expect(Object.keys(state.opacity ?? {})).toEqual(["ok"]);
    expect(Object.getPrototypeOf(state.opacity)).toBe(Object.prototype);
    expect(JSON.stringify(state)).not.toContain("attacker");
  });

  it("reads the opacity of a layer by its own id, also when the id names a member of every object", () => {
    expect(layerOpacity({ id: "constructor" }, {})).toBe(1);
    expect(layerOpacity({ id: "constructor" }, { opacity: { other: 0.2 } })).toBe(1);
    expect(layerOpacity({ id: "constructor", opacity: 0.6 }, { opacity: {} })).toBe(
      0.6,
    );
    const kept = mapViewState(JSON.parse('{ "opacity": { "constructor": 0.4 } }'));
    expect(layerOpacity({ id: "constructor", opacity: 0.6 }, kept)).toBe(0.4);
  });

  it("keeps the context layers a reader turned on and off, as ids of the fixed list", () => {
    const state = mapViewState({
      basemap: {
        context: ["pois", "buildings", "pois", "green", "roads", 7],
        contextOff: ["green", "railways", "https://attacker.example", null],
      },
    });
    expect(state).toEqual({
      basemap: { context: ["buildings", "pois"], contextOff: ["green", "railways"] },
    });
    expect(mapViewState(state)).toEqual(state);
  });

  it.each([
    "buildings",
    { 0: "buildings" },
    7,
    null,
    [["buildings"]],
    ["https://attacker.example/{z}/{x}/{y}.pbf", "BUILDINGS", "__proto__"],
    Array.from({ length: 5000 }, () => "x"),
  ])("keeps no context layer from %j", (context) => {
    const state = mapViewState({ basemap: { context, contextOff: context } });
    expect(state).toEqual({});
  });

  it("keeps the shapes that filter the marks as ids of the grammar, and that the shapes are off", () => {
    expect(
      mapViewState({
        inside: ["shape-1", "https://x.test", "__proto__", "shape-1", 3, "B"],
        drawn: "off",
      }),
    ).toEqual({ inside: ["shape-1"], drawn: "off" });
    expect(mapViewState({ inside: "shape-1", drawn: true })).toEqual({});
    expect(mapViewState({ inside: [], drawn: "on" })).toEqual({});
  });

  it("bounds its lists", () => {
    const many = Array.from({ length: 500 }, (_, i) => `layer-${i}`);
    const state = mapViewState({
      hidden: many,
      opacity: Object.fromEntries(many.map((id) => [id, 0.5])),
    });
    expect(state.hidden).toHaveLength(MAP_LIMITS.viewIds);
    expect(Object.keys(state.opacity ?? {})).toHaveLength(MAP_LIMITS.viewIds);
  });

  it("says whether a layer is drawn and how opaque", () => {
    const view = mapViewState({ hidden: ["a"], shown: ["b"], opacity: { a: 0.3 } });
    expect(layerVisible({ id: "a" }, view)).toBe(false);
    expect(layerVisible({ id: "c" }, view)).toBe(true);
    expect(layerVisible({ id: "b", visible: false }, view)).toBe(true);
    expect(layerVisible({ id: "d", visible: false }, view)).toBe(false);
    expect(layerOpacity({ id: "a", opacity: 0.8 }, view)).toBe(0.3);
    expect(layerOpacity({ id: "c", opacity: 0.8 }, view)).toBe(0.8);
    expect(layerOpacity({ id: "c" }, view)).toBe(1);
  });

  it("reads the step of a map that plays as a text of the map: cleaned, on one line, and the same when read again", () => {
    expect(mapViewState({ frame: " 2024\u202e-03\u0000 " })).toEqual({
      frame: "2024-03",
    });
    expect(mapViewState({ frame: "2024\n03" })).toEqual({ frame: "2024 03" });
    expect(mapViewState({ frame: "\u202e" })).toEqual({});
    expect(mapViewState({ frame: 2024 })).toEqual({});
    expect(mapViewState({ frame: `${"2".repeat(MAP_LIMITS.frameChars)}x` })).toEqual(
      {},
    );
    const read = mapViewState({ frame: " 2024  Q1 " });
    expect(mapViewState(read)).toEqual(read);
  });
});

describe("the close points of a layer", () => {
  it("are grouped or apart as the reader said, by ids of the grammar of a layer", () => {
    expect(
      mapViewState({
        grouped: ["points", "both", "https://attacker.example"],
        ungrouped: ["both", "sites", 7],
      }),
    ).toEqual({ grouped: ["points"], ungrouped: ["both", "sites"] });
    expect(mapViewState({ grouped: "points", ungrouped: null })).toEqual({});
  });

  it("follow the map where the reader said nothing: grouped on a crowded one", () => {
    const layer = { id: "points" };
    expect(layerGrouped(layer, {}, true)).toBe(true);
    expect(layerGrouped(layer, {}, false)).toBe(false);
    expect(layerGrouped(layer, { ungrouped: ["points"] }, true)).toBe(false);
    expect(layerGrouped(layer, { grouped: ["points"] }, false)).toBe(true);
  });
});

describe("the boundary layers of a view state", () => {
  it("are ids of the fixed list, once each, in the order of the list", () => {
    expect(
      mapViewState({
        boundaries: ["cities", "us-states", "cities", "https://attacker.example", 3],
      }),
    ).toEqual({ boundaries: ["us-states", "cities"] });
  });

  it("are nothing for a value that is no list, and read a bounded number of entries", () => {
    for (const raw of ["us-states", { 0: "us-states" }, null, 4])
      expect(mapViewState({ boundaries: raw })).toEqual({});
    const long = [...Array.from({ length: 5_000 }, () => "x"), "us-states"];
    expect(mapViewState({ boundaries: long })).toEqual({});
  });
});

describe("where a reader left a map", () => {
  it("is kept as bounded numbers: a middle, a zoom, and a turn and a tilt when there are some", () => {
    expect(
      mapViewState({
        camera: { center: [-98.123456789, 39.5], zoom: 4.256, bearing: 0, pitch: 0 },
      }),
    ).toEqual({ camera: { center: [-98.12346, 39.5], zoom: 4.26 } });
    expect(
      mapViewState({
        camera: {
          center: [2.35, 48.85],
          zoom: 11,
          bearing: -24.04,
          pitch: 52,
          of: [2.1234567, 48.7, 2.5, 49],
          style: "https://attacker.example/style.json",
        },
      }),
    ).toEqual({
      camera: {
        center: [2.35, 48.85],
        zoom: 11,
        bearing: -24,
        pitch: 52,
        of: [2.123, 48.7, 2.5, 49],
      },
    });
  });

  it.each([
    ["no middle", { zoom: 3 }],
    ["a middle of text", { center: ["-98", "39"], zoom: 3 }],
    ["a middle of three numbers", { center: [1, 2, 3], zoom: 3 }],
    ["a longitude off the world", { center: [181, 0], zoom: 3 }],
    ["a latitude off the world", { center: [0, 91], zoom: 3 }],
    ["a zoom that is no number", { center: [0, 0], zoom: Number.NaN }],
    ["a zoom under none", { center: [0, 0], zoom: -1 }],
    ["a zoom no map has", { center: [0, 0], zoom: MAP_LIMITS.viewZoom + 1 }],
    ["a list", [0, 0, 3]],
    ["text", "0,0,3"],
  ])("is no camera with %s", (_what, camera) => {
    expect(mapViewState({ camera })).toEqual({});
  });

  it("drops a turn, a tilt and a box that are out of range, and keeps the place", () => {
    expect(
      mapViewState({
        camera: {
          center: [0, 0],
          zoom: 2,
          bearing: 720,
          pitch: 89,
          of: [0, 0, 1e9, 1],
        },
      }),
    ).toEqual({ camera: { center: [0, 0], zoom: 2 } });
  });

  it("keeps the box that was visible, to a ten-thousandth of a degree, and no box that is not one", () => {
    const camera = { center: [-87.63, 41.88], zoom: 13.5 };
    expect(
      mapViewState({
        camera: { ...camera, box: [-87.701234567, 41.84, -87.56, 41.920049] },
      }).camera?.box,
    ).toEqual([-87.7012, 41.84, -87.56, 41.92]);
    expect(
      mapViewState({ camera: { ...camera, box: [-200, 10, -150, 40] } }).camera?.box,
    ).toEqual([-200, 10, -150, 40]);
    for (const box of [
      [-87.7, 41.84, -87.56],
      [-87.7, 41.84, -87.56, "41.92"],
      [-87.7, 41.84, 1e9, 41.92],
      [-87.7, 95, -87.56, 41.92],
      [-87.5, 41.84, -87.7, 41.92],
      [-87.7, 41.92, -87.56, 41.84],
      "everything",
    ])
      expect(mapViewState({ camera: { ...camera, box } })).toEqual({ camera });
  });

  it("is the view a map opens on only when the numbers are the same: middle, zoom, turn and tilt, or the box alone", () => {
    const camera = {
      center: [-87.6298, 41.8781] as [number, number],
      zoom: 12.4,
      bearing: 20,
      pitch: 30,
      box: [-87.75, 41.8, -87.5, 41.95] as [number, number, number, number],
    };
    expect(
      sameView(
        { center: [-87.6298, 41.8781], zoom: 12.4, bearing: 20, pitch: 30 },
        camera,
      ),
    ).toBe(true);
    expect(
      sameView(
        { center: [-87.62985, 41.87815], zoom: 12.405, bearing: 20.2, pitch: 30 },
        camera,
      ),
    ).toBe(true);
    expect(sameView({ bounds: [-87.75, 41.8, -87.5, 41.95] }, camera)).toBe(true);
    expect(
      sameView(
        { center: [-87.6298, 41.8781], zoom: 12, bearing: 20, pitch: 30 },
        camera,
      ),
    ).toBe(false);
    expect(
      sameView(
        { center: [-87.631, 41.8781], zoom: 12.4, bearing: 20, pitch: 30 },
        camera,
      ),
    ).toBe(false);
    expect(sameView({ center: [-87.6298, 41.8781], zoom: 12.4 }, camera)).toBe(false);
    const flat = { center: [2.35, 48.85] as [number, number], zoom: 10 };
    expect(
      sameView({ center: [2.35, 48.85], zoom: 10, bearing: 0, pitch: 0 }, flat),
    ).toBe(true);
    expect(
      sameView({ center: [0, 0], bounds: [-87.75, 41.8, -87.5, 41.95] }, camera),
    ).toBe(false);
    expect(sameView({ bounds: [-87.75, 41.8, -87.5, 41.95] }, flat)).toBe(false);
    expect(sameView({ bounds: [-88, 41.8, -87.5, 41.95] }, camera)).toBe(false);
    expect(sameView(undefined, camera)).toBe(false);
  });

  it("is of the data the map had: the same box, to a thousandth of a degree", () => {
    const camera = {
      center: [0, 0] as [number, number],
      zoom: 2,
      of: cameraBox([1, 2, 3, 4]),
    };
    expect(cameraIsOf(camera, [1.0002, 2, 3, 4])).toBe(true);
    expect(cameraIsOf(camera, [1.01, 2, 3, 4])).toBe(false);
    expect(cameraIsOf(camera, null)).toBe(false);
    expect(cameraIsOf({ center: [0, 0], zoom: 2 }, null)).toBe(true);
    expect(cameraIsOf({ center: [0, 0], zoom: 2 }, [1, 2, 3, 4])).toBe(false);
  });
});

describe("the box of a view from its numbers", () => {
  it("is the box a map of that size shows, in Web Mercator", () => {
    expect(boxOfView({ center: [0, 0], zoom: 0 }, { width: 512, height: 512 })).toEqual(
      [-180, -85.0511, 180, 85.0511],
    );
    const quarter = boxOfView({ center: [0, 0], zoom: 1 }, { width: 512, height: 512 });
    expect(quarter).toEqual([-90, -66.5133, 90, 66.5133]);
    const [west, , east] = boxOfView(
      { center: [-73.98, 40.75], zoom: 13 },
      { width: 1000, height: 700 },
    ) as number[];
    expect((west + east) / 2).toBeCloseTo(-73.98, 3);
    expect(east - west).toBeCloseTo((1000 / (512 * 2 ** 13)) * 360, 3);
  });

  it("is none for a map without a size, and for a view that is turned or tilted", () => {
    const camera = { center: [2, 48] as [number, number], zoom: 9 };
    expect(boxOfView(camera, null)).toBeUndefined();
    expect(boxOfView(camera, { width: 0, height: 400 })).toBeUndefined();
    expect(
      boxOfView({ ...camera, bearing: 12 }, { width: 800, height: 400 }),
    ).toBeUndefined();
    expect(
      boxOfView({ ...camera, pitch: 30 }, { width: 800, height: 400 }),
    ).toBeUndefined();
  });

  it("is used only for a camera that has no box of its own", () => {
    const kept = {
      center: [2, 48] as [number, number],
      zoom: 9,
      box: [1, 47, 3, 49] as [number, number, number, number],
    };
    expect(cameraWithBox(kept, { width: 800, height: 400 })).toBe(kept);
    expect(
      cameraWithBox({ center: [2, 48], zoom: 9 }, { width: 800, height: 400 })?.box,
    ).toBeDefined();
    expect(cameraWithBox(undefined, { width: 800, height: 400 })).toBeUndefined();
  });
});

describe("a camera that holds whatever the data of its map becomes", () => {
  it("is kept by the reducer, is of every map, and is what a view with a camera becomes when a layer is added from outside", () => {
    const view = {
      boundaries: ["countries"],
      camera: { center: [4.5, 48.5], zoom: 4 },
    };
    const held = heldView(view);
    expect(held).toEqual({ ...view, camera: { ...view.camera, held: true } });
    expect(view.camera).not.toHaveProperty("held");
    expect(heldView(held)).toBe(held);
    const { camera } = mapViewState(held);
    expect(camera).toEqual({ center: [4.5, 48.5], zoom: 4, held: true });
    expect(cameraIsOf(camera as never, [2, 45, 5, 51])).toBe(true);
    expect(cameraIsOf(camera as never, null)).toBe(true);
    expect(
      mapViewState({ camera: { center: [4.5, 48.5], zoom: 4, held: "yes" } }).camera,
    ).toEqual({
      center: [4.5, 48.5],
      zoom: 4,
    });
  });

  it("leaves a view without a camera as it is: a map nobody moved shows all its data", () => {
    const view = { boundaries: ["countries"] };
    expect(heldView(view)).toBe(view);
    expect(heldView(undefined)).toBeUndefined();
    expect(heldView("x")).toBe("x");
  });
});

describe("a camera an agent asked for as a box while the map was not drawn", () => {
  it("keeps the box to fit, and is no box to fit without a box", () => {
    const paris = [2.25, 48.81, 2.42, 48.9];
    expect(
      mapViewState({
        camera: { center: [2.3, 48.8], zoom: 9, box: paris, fit: true, held: true },
      }).camera,
    ).toEqual({ center: [2.3, 48.8], zoom: 9, box: paris, fit: true, held: true });
    expect(
      mapViewState({ camera: { center: [2.3, 48.8], zoom: 9, fit: true } }).camera,
    ).toEqual({ center: [2.3, 48.8], zoom: 9 });
    expect(
      mapViewState({ camera: { center: [2.3, 48.8], zoom: 9, box: paris, fit: 1 } })
        .camera,
    ).not.toHaveProperty("fit");
  });
});
