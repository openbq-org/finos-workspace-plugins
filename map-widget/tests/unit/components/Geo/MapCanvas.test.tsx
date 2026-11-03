import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapCanvas from "~/components/Geo/MapCanvas";
import { FRAME_MS } from "~/components/Geo/TimeSlider";
import { mapSpec } from "~/lib/geo/mapSpec";
import { expectNoUseAfterRemove, FakeMap, fakeLibrary, pointerAt } from "./fakeMap";
import { sets, states, world } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const loaded = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("~/components/Geo/useMapData", () => ({
  useMapData: () => loaded.data,
  useBasemap: () => null,
  useHeldArchives: () => true,
}));
const rowRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("~/components/Geo/LayerSwatch", () => ({
  LayerSwatch: ({ layer }: { layer: { id: string } }) => {
    rowRenders.set(layer.id, (rowRenders.get(layer.id) ?? 0) + 1);
    return null;
  },
}));
vi.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: 900, height: 500, ref: { current: null } }),
}));

const TWO = mapSpec({
  points: [
    { lat: 40, lon: -100, label: "Alpha" },
    { lat: 30, lon: -90, label: "Beta" },
  ],
});

const mount = (props: Partial<Parameters<typeof MapCanvas>[0]> = {}) => {
  const onFail = vi.fn();
  const view = render(<MapCanvas spec={TWO} name="Sites" onFail={onFail} {...props} />);
  const map = FakeMap.last();
  act(() => map.loadStyle());
  return { ...view, map, onFail };
};
const clickMark = (map: FakeMap, index: number) => {
  map.drawn = [{ layer: { id: "points" }, properties: { i: index } }];
  act(() => map.fire("click", pointerAt(100 + index, 100)));
};

beforeEach(() => {
  FakeMap.reset();
  rowRenders.clear();
  loaded.data = { lib: fakeLibrary(), world, states, sets, unloaded: [] };
});

describe("the note of a map that opens on a view somebody asked for", () => {
  const OFFICES = mapSpec({
    points: [
      { lat: 40.75, lon: -73.98, label: "Midtown" },
      { lat: 41.76, lon: -72.67, label: "Hartford" },
      { lat: 41.88, lon: -87.63, label: "Chicago" },
    ],
    view: { center: [-73.98, 40.75], zoom: 11, box: [-74.05, 40.7, -73.9, 40.8] },
  });
  const open = (shown: [number, number, number, number]) => {
    FakeMap.shows = shown;
    render(<MapCanvas spec={OFFICES} name="Offices" onFail={vi.fn()} />);
    act(() => FakeMap.last().loadStyle());
  };

  it("counts in the area of the Map widget, and names it, in a picture wider than the widget the view is of", () => {
    open([-75, 40, -72, 42.5]);
    expect(screen.getByRole("status").textContent).toMatch(
      /^1 of 3 points is in the area your Map shows( · |$)/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(
      screen.getByText(
        "1 of 3 points is in the area your Map shows: Show all data fits the map to all of them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2 of 3 points/)).toBeNull();
    expect(screen.queryByText(/in this view/)).toBeNull();
  });

  it("counts the points this picture shows for a box that was asked for, which is no view of a Map widget", () => {
    FakeMap.shows = [-75, 40, -72, 42.5];
    render(
      <MapCanvas
        spec={mapSpec({ ...OFFICES, view: { bounds: [-74.05, 40.7, -73.9, 40.8] } })}
        name="Offices"
        onFail={vi.fn()}
      />,
    );
    act(() => FakeMap.last().loadStyle());
    expect(screen.getByText(/2 of 3 points are in this view/)).toBeInTheDocument();
    expect(screen.queryByText(/your Map/)).toBeNull();
  });

  it("clears the opening-area count after Show all data and restores it on Reset view", () => {
    open([-74.05, 40.7, -73.9, 40.8]);
    expect(
      screen.getByText(/1 of 3 points is in the area your Map shows/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show all data" }));
    expect(screen.queryByText(/points? (is|are) in/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(
      screen.getByText(/1 of 3 points is in the area your Map shows/),
    ).toBeVisible();
  });

  it("says no count for a view that names no box: a middle and a zoom alone", () => {
    FakeMap.shows = [-74.05, 40.7, -73.9, 40.8];
    render(
      <MapCanvas
        spec={mapSpec({ ...OFFICES, view: { center: [-73.98, 40.75], zoom: 11 } })}
        name="Offices"
        onFail={vi.fn()}
      />,
    );
    act(() => FakeMap.last().loadStyle());
    expect(screen.queryByText(/in this view/)).toBeNull();
    expect(screen.queryByText(/your Map/)).toBeNull();
  });

  it("counts the same where the picture shows what the widget showed", () => {
    open([-74.05, 40.7, -73.9, 40.8]);
    expect(
      screen.getByText(/1 of 3 points is in the area your Map shows/),
    ).toBeInTheDocument();
  });
});

describe("the tag a reader writes in the card of a mark", () => {
  it("is not carried to the card of another mark when it was not saved", () => {
    const onNotesChange = vi.fn();
    const { map } = mount({ onNotesChange });
    clickMark(map, 0);
    expect(screen.getByRole("group", { name: "Details of Alpha" })).toBeInTheDocument();
    const field = screen.getByLabelText("Your tag for this place") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "only for Alpha" } });
    expect(field.value).toBe("only for Alpha");

    clickMark(map, 1);
    expect(screen.getByRole("group", { name: "Details of Beta" })).toBeInTheDocument();
    const next = screen.getByLabelText("Your tag for this place") as HTMLInputElement;
    expect(next.value).toBe("");
    fireEvent.keyDown(next, { key: "Enter" });
    expect(onNotesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ "p:30,-90": "only for Alpha" }),
    );
    for (const [notes] of onNotesChange.mock.calls)
      expect(Object.values(notes)).not.toContain("only for Alpha");
  });

  it("is saved under the mark it was written for", () => {
    const onNotesChange = vi.fn();
    const { map } = mount({ onNotesChange });
    clickMark(map, 1);
    const field = screen.getByLabelText("Your tag for this place");
    fireEvent.change(field, { target: { value: "depot" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onNotesChange).toHaveBeenCalledTimes(1);
    expect(Object.values(onNotesChange.mock.calls[0][0])).toEqual(["depot"]);
  });
});

describe("the buttons of the view", () => {
  const button = (name: string) =>
    within(screen.getByRole("toolbar", { name: "Map view" })).getByRole("button", {
      name,
    });

  it("zooms in by one level with Zoom in and out by one with Zoom out, from where the map is", () => {
    const { map } = mount();
    map.zoom = 4;
    map.easeTo.mockClear();
    fireEvent.click(button("Zoom in"));
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    expect(map.easeTo).toHaveBeenLastCalledWith({ zoom: 5, duration: 200 });
    fireEvent.click(button("Zoom out"));
    expect(map.easeTo).toHaveBeenCalledTimes(2);
    expect(map.easeTo).toHaveBeenLastCalledWith({ zoom: 3, duration: 200 });
  });

  it("fits the data again with Reset view, and has no Show all data on a map that opens on its data", () => {
    const { map } = mount();
    const fitted = map.fitBounds.mock.calls.length;
    expect(fitted).toBeGreaterThan(0);
    const [box] = map.fitBounds.mock.calls[fitted - 1];
    fireEvent.click(button("Reset view"));
    expect(map.fitBounds).toHaveBeenCalledTimes(fitted + 1);
    expect(map.fitBounds.mock.calls[fitted][0]).toEqual(box);
    expect(
      within(screen.getByRole("toolbar", { name: "Map view" })).queryByRole("button", {
        name: "Show all data",
      }),
    ).toBeNull();
  });

  it("fits every mark with Show all data on a map that opens somewhere else, and returns with Reset view", () => {
    const paris = { center: [2.35, 48.85] as [number, number], zoom: 5 };
    const { map } = mount({ spec: mapSpec({ ...TWO, view: paris }) });
    expect(map.jumpTo).toHaveBeenCalledWith(expect.objectContaining(paris));
    expect(map.fitBounds).not.toHaveBeenCalled();
    fireEvent.click(button("Show all data"));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const [[[west, south], [east, north]]] = map.fitBounds.mock.calls[0];
    expect(west).toBeLessThanOrEqual(-100);
    expect(east).toBeGreaterThanOrEqual(-90);
    expect(south).toBeLessThanOrEqual(30);
    expect(north).toBeGreaterThanOrEqual(40);
    map.jumpTo.mockClear();
    fireEvent.click(button("Reset view"));
    expect(map.jumpTo).toHaveBeenCalledWith(expect.objectContaining(paris));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
  });
});

describe("a map that plays", () => {
  const YEARS = mapSpec({
    frame: "2021",
    layers: [
      {
        id: "sites",
        kind: "points",
        points: [
          { lat: 40, lon: -100, time: "2021" },
          { lat: 41, lon: -101, time: "2022" },
          { lat: 42, lon: -102, time: "2023" },
        ],
      },
      { id: "depots", name: "Depots", kind: "points", points: [{ lat: 30, lon: -90 }] },
    ],
  });
  const step = () => screen.getByLabelText("Time").getAttribute("aria-valuetext");
  const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps its pace while the reader changes something else", () => {
    mount({ spec: YEARS });
    expect(step()).toBe("2021");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    pass(FRAME_MS / 2);
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    pass(FRAME_MS / 2 - 50);
    fireEvent.click(screen.getByRole("button", { name: "Show Depots" }));
    pass(100);
    expect(step()).toBe("2022");
  });

  it("keeps what the reader switched while it plays", () => {
    mount({ spec: YEARS });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Depots" }));
    pass(FRAME_MS);
    pass(FRAME_MS);
    expect(step()).toBe("2023");
    expect(
      screen.getByRole("button", { name: "Show Depots" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("region", { name: "Layers" })).toBeInTheDocument();
  });

  it("does not render the rows of the panel again at a step", () => {
    mount({ spec: YEARS });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const before = new Map(rowRenders);
    expect(before.get("sites")).toBeGreaterThan(0);
    pass(FRAME_MS);
    expect(step()).toBe("2022");
    expect(new Map(rowRenders)).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Show Depots" }));
    expect(rowRenders.get("depots")).toBe((before.get("depots") ?? 0) + 1);
    expect(rowRenders.get("sites")).toBe(before.get("sites"));
  });
});

describe("the focus of the keyboard around the layer panel", () => {
  const layers = () => screen.getByRole("button", { name: "Layers" });

  it("goes into the panel when it opens, and back to its button at Escape", () => {
    mount();
    layers().focus();
    fireEvent.click(layers());
    const close = screen.getByRole("button", { name: "Close layers" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
    expect(document.activeElement).toBe(layers());
  });

  it("goes back to the button from wherever it was in the panel when the panel is closed", () => {
    mount();
    fireEvent.click(layers());
    const eye = screen.getByRole("button", { name: "Show Points" });
    eye.focus();
    fireEvent.keyDown(eye, { key: "Escape" });
    expect(document.activeElement).toBe(layers());
    fireEvent.click(layers());
    fireEvent.click(screen.getByRole("button", { name: "Close layers" }));
    expect(document.activeElement).toBe(layers());
  });

  it("stays where the reader put it when the panel is closed from outside", () => {
    mount();
    fireEvent.click(layers());
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    zoomIn.focus();
    fireEvent.click(layers());
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
    expect(document.activeElement).toBe(zoomIn);
  });
});

describe("the data of a drawn map, for a keyboard and a screen reader", () => {
  const data = () => screen.getByRole("button", { name: "Show data" });

  it("is one button away on every map: the marks as a table, and the map again", () => {
    const { map } = mount();
    expect(data().getAttribute("aria-pressed")).toBe("false");
    expect(map.canvas.tabIndex).not.toBe(-1);
    fireEvent.click(data());
    expect(data().getAttribute("aria-pressed")).toBe("true");
    const table = screen.getByRole("region", { name: "Data of map Sites" });
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Alpha", "Beta"]);
    expect(map.canvas.tabIndex).toBe(-1);
    expect(screen.queryByRole("button", { name: "Layers" })).toBeNull();
    fireEvent.click(data());
    expect(screen.queryByRole("region", { name: "Data of map Sites" })).toBeNull();
    expect(map.canvas.tabIndex).not.toBe(-1);
    expect(screen.getByRole("button", { name: "Layers" })).toBeInTheDocument();
  });

  it("takes the focus when it opens and gives it back to its button at Escape", () => {
    mount();
    data().focus();
    fireEvent.click(data());
    const heading = screen.getByRole("heading", { name: "Data of the map" });
    expect(document.activeElement).toBe(heading);
    fireEvent.keyDown(heading, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Data of map Sites" })).toBeNull();
    expect(document.activeElement).toBe(data());
  });

  it("tags a mark from its row, where the map keeps tags", () => {
    const onNotesChange = vi.fn();
    mount({ onNotesChange });
    fireEvent.click(data());
    fireEvent.click(screen.getByRole("button", { name: "Add tag to Beta" }));
    const field = screen.getByLabelText("Your tag for Beta");
    fireEvent.change(field, { target: { value: "depot" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onNotesChange).toHaveBeenCalledTimes(1);
    expect(Object.values(onNotesChange.mock.calls[0][0])).toEqual(["depot"]);
  });

  it("reads the tags and takes none where the map keeps none", () => {
    mount();
    fireEvent.click(data());
    expect(screen.queryByRole("button", { name: /Add tag/ })).toBeNull();
  });
});

describe("the map of the library, from the first style to the last", () => {
  it("is made once, flat, with the wheel left to the page, and removed with the view", () => {
    const { map, unmount } = mount();
    expect(FakeMap.made).toHaveLength(1);
    expect(map.options).toMatchObject({
      cooperativeGestures: true,
      dragRotate: false,
      maxPitch: 0,
      attributionControl: false,
      style: { version: 8, sources: {}, layers: [] },
    });
    expect(map.listeners()).toBeGreaterThan(0);
    unmount();
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(map.listeners()).toBe(0);
  });

  it("lets the wheel zoom a map that was opened large", () => {
    const { map } = mount({ expanded: true });
    expect(map.options.cooperativeGestures).toBe(false);
  });

  it("names its canvas, and is not made again when the name changes", () => {
    const { map, rerender, onFail } = mount();
    expect(map.canvas.getAttribute("aria-label")).toBe(
      "Map Sites. Arrow keys move it, plus and minus zoom.",
    );
    rerender(<MapCanvas spec={TWO} name="Depots" onFail={onFail} />);
    expect(map.canvas.getAttribute("aria-label")).toBe(
      "Map Depots. Arrow keys move it, plus and minus zoom.",
    );
    expect(FakeMap.made).toHaveLength(1);
    expect(map.remove).not.toHaveBeenCalled();
  });

  it("says that the browser cannot draw when the library cannot make its map", () => {
    FakeMap.fails = true;
    const onFail = vi.fn();
    render(<MapCanvas spec={TWO} name="Sites" onFail={onFail} />);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0]).toMatch(/cannot draw the map: WebGL/);
    expect(screen.getByRole("status").textContent).toBe("Loading the map...");
  });

  it("shows that it is loading until the files of the map are there", () => {
    loaded.data = null;
    render(<MapCanvas spec={TWO} name="Sites" onFail={vi.fn()} />);
    expect(FakeMap.made).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("Loading the map...");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("draws the rest of the map when the file of one boundary set did not load, and says so on its layer", () => {
    const { "us-states": _gone, ...others } = sets;
    loaded.data = {
      lib: fakeLibrary(),
      world,
      states,
      sets: others,
      unloaded: ["us-states"],
    };
    const { map } = mount({
      spec: mapSpec({
        layers: [
          {
            id: "shaded",
            name: "Sales",
            kind: "regions",
            regions: { set: "us-states", items: [{ code: "06" }] },
          },
          { id: "sites", name: "Sites", kind: "points", points: TWO.points },
        ],
      }),
    });
    expect(Object.keys(map.styles.at(-1)?.sources ?? {})).toContain("l:sites");
    expect(screen.queryByText(/not on the map/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getAllByText("Could not be loaded.")).toHaveLength(1);
  });

  it("outlines the mark whose card is open, and no mark when none is", () => {
    const { map } = mount();
    const outlined = () =>
      map.setFilter.mock.calls.filter(([id]) => id === "points-hover").at(-1)?.[1];
    expect(outlined()).toBeUndefined();
    clickMark(map, 1);
    expect(outlined()).toEqual(["==", ["get", "i"], 1]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(outlined()).toEqual(["==", ["get", "i"], -1]);
    expect(screen.queryByRole("group", { name: "Details of Beta" })).toBeNull();
  });

  it("closes the card of a mark whose layer the reader turns off", () => {
    const { map } = mount();
    clickMark(map, 0);
    expect(screen.getByRole("group", { name: "Details of Alpha" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Points" }));
    expect(screen.queryByRole("group", { name: "Details of Alpha" })).toBeNull();
  });
});

describe("a map that says what it opens with", () => {
  const ASKS = mapSpec({
    points: [{ lat: 40, lon: -100, label: "Alpha" }],
    shapes: [],
    boundaries: ["us-states"],
    basemap: { choice: "plain" },
  });
  const states = () => screen.getByLabelText(/^US states/) as HTMLInputElement;
  const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has its boundary layer on in the panel of an untouched map, and stores nothing for it", () => {
    const onViewChange = vi.fn();
    const { map } = mount({ spec: ASKS, onViewChange });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(states().checked).toBe(true);
    expect((screen.getByLabelText("Countries") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(Object.keys(map.styles.at(-1)?.sources ?? {})).not.toContain("basemap");
    pass(5_000);
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("keeps what the reader switches: the layer of the map off, another on", () => {
    const onViewChange = vi.fn();
    mount({ spec: ASKS, onViewChange });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(states());
    fireEvent.click(screen.getByLabelText("Cities"));
    expect(states().checked).toBe(false);
    pass(5_000);
    expect(onViewChange).toHaveBeenLastCalledWith({
      boundaries: ["cities"],
      boundariesOff: ["us-states"],
    });
  });

  it("opens as its reader left it when the stored view says so", () => {
    mount({ spec: ASKS, view: { boundariesOff: ["us-states"], panel: "open" } });
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(states().checked).toBe(false);
  });
});
