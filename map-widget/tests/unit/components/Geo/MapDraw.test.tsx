import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "~/components/Geo/MapView";
import { SHAPES_SOURCE } from "~/components/Geo/shapeLayers";
import { copyText } from "~/host";
import type { DrawnShape } from "~/lib/geo/mapShapes";
import { setMeasureSystem } from "~/lib/state/mapUnits";
import { findLoaded } from "../../lazyLoaded";
import { expectNoUseAfterRemove, FakeMap, fakeLibrary, pointerAt } from "./fakeMap";
import { sets, states, world } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const loaded = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("~/components/Geo/useMapData", () => ({
  useMapData: () => loaded.data,
  useBasemap: () => null,
  useHeldArchives: () => true,
}));
vi.mock("~/host", () => ({ copyText: vi.fn(async () => {}) }));
vi.mock("~/components/Geo/mapLibrary", () => ({ canDrawMaps: () => true }));
vi.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: 900, height: 500, ref: { current: null } }),
}));
class Observer {
  constructor(private readonly tell: (entries: { isIntersecting: boolean }[]) => void) {
    queueMicrotask(() => act(() => this.tell([{ isIntersecting: true }])));
  }
  observe() {}
  disconnect() {}
}

const SPEC = {
  title: "Stores",
  points: [
    { lat: 48.85, lon: 2.35, label: "Paris" },
    { lat: 45.76, lon: 4.84, label: "Lyon" },
    { lat: 40.71, lon: -74.01, label: "New York" },
  ],
};
const FRANCE = {
  id: "fr",
  kind: "rectangle",
  name: "France box",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-5, 42],
        [8, 42],
        [8, 51],
        [-5, 51],
        [-5, 42],
      ],
    ],
  },
};

function Kept({
  stored = [],
  onKept,
}: {
  stored?: unknown;
  onKept?: (shapes: DrawnShape[]) => void;
}) {
  const [shapes, setShapes] = useState<unknown>(stored);
  const [view, setView] = useState<unknown>(undefined);
  return (
    <div className="flex flex-col">
      <MapView
        spec={SPEC}
        name="Stores"
        shapes={shapes}
        onShapesChange={(next) => {
          setShapes(next);
          onKept?.(next);
        }}
        view={view}
        onViewChange={setView}
      />
    </div>
  );
}
const map = () => FakeMap.last();
const ready = async () => {
  await act(async () => {});
  act(() => map().settle());
  await act(async () => {});
};
const click = (lon: number, lat: number) =>
  act(() => map().fire("click", pointerAt(lon * 10, -lat * 10)));
const drawnShapes = () => {
  const calls = map().setData.mock.calls.filter(([id]) => id === SHAPES_SOURCE);
  const data = (calls.at(-1)?.[1] ??
    (map().addedSources.get(SHAPES_SOURCE) as { data: unknown }).data) as {
    features: { properties: { id: string } }[];
  };
  return data.features.map((feature) => feature.properties.id);
};

beforeEach(() => {
  FakeMap.reset();
  loaded.data = { lib: fakeLibrary(), world, states, sets };
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => vi.unstubAllGlobals());

describe("a map that keeps no shapes", () => {
  it("draws the shapes it was given and has no draw tool", async () => {
    render(
      <div className="flex flex-col">
        <MapView spec={SPEC} name="Stores" shapes={[FRANCE]} />
      </div>,
    );
    await ready();
    expect(screen.queryByRole("button", { name: "Draw" })).not.toBeInTheDocument();
    expect(drawnShapes()).toEqual(["fr"]);
  });
});

describe("drawing on a map that keeps its shapes", () => {
  it("opens the toolbar from the controls, places a point at a click and keeps it", async () => {
    const user = userEvent.setup();
    const kept = vi.fn();
    render(<Kept onKept={kept} />);
    await ready();
    const draw = screen.getByRole("button", { name: "Draw" });
    expect(draw).toHaveAttribute("aria-expanded", "false");
    await user.click(draw);
    const bar = await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    expect(draw).toHaveAttribute("aria-expanded", "true");
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Point",
      "Line",
      "Area",
      "Rectangle",
      "Circle",
      "Select and edit",
      "Delete the selected shape",
      "Done drawing",
    ]);
    await user.click(within(bar).getByRole("button", { name: "Point" }));
    expect(within(bar).getByRole("button", { name: "Point" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Click the map to place a point.",
    );
    click(2, 48);
    const card = await screen.findByRole("region", { name: "Shape Point 1" });
    expect(within(card).getByLabelText("Name")).toHaveAttribute(
      "placeholder",
      "Point 1",
    );
    expect(
      within(bar).getByRole("button", { name: "Select and edit" }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(kept).toHaveBeenCalled());
    expect(kept.mock.calls.at(-1)?.[0]).toEqual([
      {
        id: "shape-1",
        kind: "point",
        geometry: { type: "Point", coordinates: [2, 48] },
      },
    ]);
    expect(drawnShapes()).toEqual(["shape-1"]);
  });

  it("names a shape, colours it and notes it from its card, as text", async () => {
    const user = userEvent.setup();
    const kept = vi.fn();
    render(<Kept stored={[FRANCE]} onKept={kept} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    click(0, 45);
    const card = await screen.findByRole("region", { name: "Shape France box" });
    const name = within(card).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "<b>Zone</b>{Enter}");
    await user.click(within(card).getByRole("button", { name: "Violet" }));
    await user.type(within(card).getByLabelText("Note"), "Mondays");
    await user.tab();
    await waitFor(() =>
      expect(kept.mock.calls.at(-1)?.[0]).toMatchObject([
        { id: "fr", name: "<b>Zone</b>", color: 2, note: "Mondays" },
      ]),
    );
    expect(
      screen.getByRole("region", { name: "Shape <b>Zone</b>" }),
    ).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows only what is inside a shape, says so on a chip, and shows all again from the chip", async () => {
    const user = userEvent.setup();
    render(<Kept stored={[FRANCE]} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    click(0, 45);
    const card = await screen.findByRole("region", { name: "Shape France box" });
    const filter = within(card).getByRole("checkbox", {
      name: /Show only what is inside/,
    });
    expect(card).toHaveTextContent(
      "Points inside the shape; regions, areas and lines by their middle; flows with both ends inside.",
    );
    await user.click(filter);
    await ready();
    const chip = document.querySelector("[data-map-inside]") as HTMLElement;
    expect(chip).toHaveTextContent("Filtered by: France box");
    expect(chip).toHaveTextContent("2 of 3");
    await user.click(
      within(screen.getByRole("toolbar", { name: "Draw" })).getByRole("button", {
        name: "Done drawing",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Show data" }));
    const table = screen.getByRole("region", { name: "Data of map Stores" });
    expect(within(table).getByText("Paris")).toBeInTheDocument();
    expect(within(table).queryByText("New York")).not.toBeInTheDocument();
    const mine = table.querySelector("[data-map-shapes]") as HTMLElement;
    expect(mine).toHaveTextContent("My shapes (1)");
    expect(within(mine).getByText("France box")).toBeInTheDocument();
    expect(within(mine).getByText("Rectangle")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show data" }));
    await user.click(
      screen.getByRole("button", { name: "Clear the filter: show all marks" }),
    );
    await ready();
    expect(document.querySelector("[data-map-inside]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show data" }));
    expect(
      within(screen.getByRole("region", { name: "Data of map Stores" })).getByText(
        "New York",
      ),
    ).toBeInTheDocument();
  });

  it("filters by a shape that was drawn a moment ago as soon as its box is ticked", async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const toolbar = await findLoaded(() =>
      screen.getByRole("toolbar", { name: "Draw" }),
    );
    await user.click(within(toolbar).getByRole("button", { name: "Rectangle" }));
    click(-5, 42);
    click(8, 51);
    const card = await screen.findByRole("region", { name: "Shape Rectangle 1" });
    const filter = within(card).getByRole("checkbox", {
      name: /Show only what is inside/,
    });
    await user.click(filter);
    expect(filter).toBeChecked();
    expect(document.querySelector("[data-map-inside]")).toHaveTextContent("2 of 3");
  });

  it("filters by a shape again once a held corner rests, not at every move of the pointer", async () => {
    const user = userEvent.setup();
    render(<Kept stored={[FRANCE]} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    click(0, 45);
    const card = await screen.findByRole("region", { name: "Shape France box" });
    await user.click(
      within(card).getByRole("checkbox", { name: /Show only what is inside/ }),
    );
    await ready();
    const chip = () => document.querySelector("[data-map-inside]") as HTMLElement;
    expect(chip()).toHaveTextContent("2 of 3");
    act(() => map().fire("mousedown", pointerAt(80, -510)));
    for (const lon of [7, 5, 4])
      act(() => map().fire("mousemove", pointerAt(lon * 10, -500)));
    expect(chip()).toHaveTextContent("2 of 3");
    act(() => map().fire("mouseup"));
    await waitFor(() => expect(chip()).toHaveTextContent("1 of 3"));
  });

  it("selects a shape from the list of the toolbar, without a pointer on the map", async () => {
    const user = userEvent.setup();
    const kept = vi.fn();
    render(
      <Kept stored={[FRANCE, { ...FRANCE, id: "second", name: "" }]} onKept={kept} />,
    );
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const toolbar = await findLoaded(() =>
      screen.getByRole("toolbar", { name: "Draw" }),
    );
    const remove = within(toolbar).getByRole("button", {
      name: "Delete the selected shape",
    });
    expect(remove).toBeDisabled();
    const list = screen.getByRole("combobox", { name: "Select a shape" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((item) => item.textContent),
    ).toEqual(["Select a shape", "France box", "Rectangle 1"]);
    list.focus();
    await user.selectOptions(list, "Rectangle 1");
    expect(
      await screen.findByRole("region", { name: "Shape Rectangle 1" }),
    ).toBeVisible();
    expect(remove).toBeEnabled();
    remove.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(kept).toHaveBeenCalled());
    expect(kept.mock.calls.at(-1)?.[0].map((shape: DrawnShape) => shape.id)).toEqual([
      "fr",
    ]);
    await user.click(within(toolbar).getByRole("button", { name: "Point" }));
    expect(screen.queryByRole("combobox", { name: "Select a shape" })).toBeNull();
  });

  it("removes the selected shape from the toolbar, and closes at Done", async () => {
    const user = userEvent.setup();
    const kept = vi.fn();
    render(<Kept stored={[FRANCE]} onKept={kept} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const bar = await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    const remove = within(bar).getByRole("button", {
      name: "Delete the selected shape",
    });
    expect(remove).toBeDisabled();
    click(0, 45);
    await screen.findByRole("region", { name: "Shape France box" });
    await user.click(remove);
    await waitFor(() => expect(kept.mock.calls.at(-1)?.[0]).toEqual([]));
    expect(screen.queryByRole("region", { name: /^Shape/ })).not.toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Done drawing" }));
    expect(screen.queryByRole("toolbar", { name: "Draw" })).not.toBeInTheDocument();
    expect(map().gestures.doubleClickZoom).toBe(true);
  });

  it("leaves the tool at Escape, and has one of the tool and the layer panel open at a time", async () => {
    const user = userEvent.setup();
    render(<Kept stored={[FRANCE]} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("toolbar", { name: "Draw" })).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Layers" });
    const mine = within(panel).getByRole("checkbox", { name: /My shapes/ });
    expect(mine).toBeChecked();
    await user.click(mine);
    expect(drawnShapes()).toEqual([]);
    await user.click(mine);
    expect(drawnShapes()).toEqual(["fr"]);
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await screen.findByRole("toolbar", { name: "Draw" });
    expect(screen.queryByRole("region", { name: "Layers" })).not.toBeInTheDocument();
    fireEvent.keyDown(map().container, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("toolbar", { name: "Draw" })).not.toBeInTheDocument(),
    );
  });

  it("opens no card of a mark while a reader draws: a click places a position", async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await ready();
    const before = map().queries;
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const bar = await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    await user.click(within(bar).getByRole("button", { name: "Line" }));
    click(2.35, 48.85);
    expect(map().queries).toBe(before);
  });
});

describe("measuring on a map", () => {
  const move = (lon: number, lat: number) =>
    act(() => map().fire("mousemove", pointerAt(lon * 10, -lat * 10)));
  beforeEach(() => setMeasureSystem("metric"));

  it("is on a map that keeps nothing too: a distance is read as it is drawn, and nothing is kept", async () => {
    const user = userEvent.setup();
    render(
      <div className="flex flex-col">
        <MapView spec={SPEC} name="Stores" />
      </div>,
    );
    await ready();
    expect(screen.queryByRole("button", { name: "Draw" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Measure" }));
    const bar = await findLoaded(() =>
      screen.getByRole("toolbar", { name: "Measure" }),
    );
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Measure a distance", "Measure an area", "Done measuring"]);
    click(0, 0);
    move(1, 0);
    const readout = screen.getByRole("status", { name: "Measure" });
    expect(readout).toHaveTextContent("Length111 km");
    click(1, 0);
    move(1, 1);
    expect(readout).toHaveTextContent("Length222 km");
    expect(readout).toHaveTextContent("Stretch 1111 km");
    expect(readout).toHaveTextContent("Stretch 2111 km");
    await user.click(
      within(readout).getByRole("button", { name: /^Units: kilometres/ }),
    );
    expect(readout).toHaveTextContent("Length138 mi");
    await user.click(within(bar).getByRole("button", { name: "Done measuring" }));
    expect(screen.queryByRole("toolbar", { name: "Measure" })).not.toBeInTheDocument();
    expect(drawnShapes()).toEqual([]);
  });

  it("measures an area, and keeps it as a shape where the map keeps shapes", async () => {
    const user = userEvent.setup();
    const kept = vi.fn();
    render(<Kept onKept={kept} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Measure" }));
    const bar = await findLoaded(() =>
      screen.getByRole("toolbar", { name: "Measure" }),
    );
    const keep = within(bar).getByRole("button", { name: "Keep as shape" });
    expect(keep).toBeDisabled();
    await user.click(within(bar).getByRole("button", { name: "Measure an area" }));
    click(0, 0);
    click(2, 0);
    click(2, 2);
    click(0, 2);
    fireEvent.keyDown(map().container, { key: "Enter" });
    const readout = screen.getByRole("status", { name: "Measure" });
    expect(readout).toHaveTextContent("Area49,452 km²");
    expect(readout).toHaveTextContent("Perimeter889 km");
    expect(kept).not.toHaveBeenCalled();
    await user.click(keep);
    const card = await screen.findByRole("region", { name: "Shape Area 1" });
    expect(card).toHaveTextContent("Area49,452 km²");
    expect(screen.getByRole("toolbar", { name: "Draw" })).toBeInTheDocument();
    await waitFor(() =>
      expect(kept.mock.calls.at(-1)?.[0]).toMatchObject([
        { id: "shape-1", kind: "polygon" },
      ]),
    );
  });

  it("says the measure of each kind in the card of a shape, and the place of a point, which copies", async () => {
    const user = userEvent.setup();
    render(
      <Kept
        stored={[
          FRANCE,
          {
            id: "c",
            kind: "circle",
            geometry: { type: "Point", coordinates: [20, 60] },
            radiusKm: 500,
          },
          {
            id: "p",
            kind: "point",
            geometry: { type: "Point", coordinates: [-73.98567, 40.74844] },
          },
        ]}
      />,
    );
    await ready();
    await user.click(screen.getByRole("button", { name: "Draw" }));
    await findLoaded(() => screen.getByRole("toolbar", { name: "Draw" }));
    click(20, 60);
    const round = await screen.findByRole("region", { name: "Shape Circle 1" });
    expect(round).toHaveTextContent("Radius500 km");
    expect(round).toHaveTextContent("Area784,995 km²");
    click(-73.98567, 40.74844);
    const point = await screen.findByRole("region", { name: "Shape Point 1" });
    expect(point).toHaveTextContent("Place40.74844, -73.98567");
    await user.click(
      within(point).getByRole("button", {
        name: "Copy the latitude and the longitude",
      }),
    );
    expect(copyText).toHaveBeenCalledWith("40.74844, -73.98567");
  });

  it("lists what each shape measures in the data of the map, in the units of the reader", async () => {
    const user = userEvent.setup();
    setMeasureSystem("imperial");
    render(<Kept stored={[FRANCE]} />);
    await ready();
    await user.click(screen.getByRole("button", { name: "Show data" }));
    const mine = document.querySelector("[data-map-shapes]") as HTMLElement;
    expect(
      within(mine).getByRole("columnheader", { name: "Measure" }),
    ).toBeInTheDocument();
    expect(mine).toHaveTextContent(/sq mi, [\d,]+ mi round/);
  });
});

describe("stored shapes that somebody else wrote", () => {
  it("draws those that are shapes and nothing of the others", async () => {
    render(
      <Kept
        stored={[
          FRANCE,
          {
            ...FRANCE,
            id: "nan",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [Number.NaN, 0],
                  [1, 1],
                  [2, 2],
                ],
              ],
            },
          },
          { ...FRANCE, id: "../../etc" },
          JSON.parse(
            '{"id":"proto","kind":"point","__proto__":{"geometry":{"type":"Point","coordinates":[0,0]}}}',
          ),
          { ...FRANCE, id: "named", name: '<img src=x onerror="alert(1)">' },
        ]}
      />,
    );
    await ready();
    expect(drawnShapes()).toEqual(["fr", "named"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Show data" }));
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img[src=x]")).toBeNull();
  });
});
