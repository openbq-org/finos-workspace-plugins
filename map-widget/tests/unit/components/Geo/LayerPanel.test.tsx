import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SceneContext } from "~/components/Geo/basemapContext";
import LayerPanel from "~/components/Geo/LayerPanel";
import { MapPanelHostContext } from "~/components/Geo/mapPanelHost";
import type { SceneLayer } from "~/components/Geo/sceneLayer";
import type { MapViewChange } from "~/components/Geo/useMapView";
import { MAP_BOUNDARIES } from "~/lib/geo/mapBoundaries";
import type { MapViewState } from "~/lib/geo/mapViewState";

const layer = (id: string, more: Partial<SceneLayer> = {}): SceneLayer => ({
  id,
  name: id,
  kind: "points",
  count: 0,
  parts: [],
  scale: null,
  color: "#ed9b44",
  swatch: "circle",
  ...more,
});

const LAYERS: SceneLayer[] = [
  layer("regions", {
    name: "Corn yield",
    kind: "regions",
    count: 3100,
    swatch: "fill",
    scale: {
      min: 0,
      max: 10,
      diverging: false,
      stops: ["#a9c8f2", "#0b3f8a"],
      color: () => "#000000",
    },
  }),
  layer("ndvi", {
    name: "NDVI",
    kind: "source",
    swatch: "raster",
    visible: false,
    opacity: 0.7,
    group: "Imagery",
  }),
  layer("radar", {
    name: "Radar",
    kind: "source",
    swatch: "raster",
    group: "Imagery",
    note: "This source is not connected.",
  }),
  layer("density", {
    name: "Density",
    kind: "heat",
    swatch: "heat",
    ramp: ["#000004", "#fcfdbf"],
    count: 12,
  }),
  layer("flows", { name: "Trade", kind: "flows", swatch: "arc", count: 4 }),
  layer("columns", { name: "Sales", kind: "columns", swatch: "column" }),
  layer("roads", { name: "Pipelines", kind: "lines", swatch: "line" }),
  layer("points", { name: "Grain elevators with a very long name", count: 42 }),
];
const BASEMAPS = [
  { id: "standard", name: "Standard" },
  { id: "plain", name: "Plain" },
];
const ALL_PARTS = { names: true, roads: true, borders: true };

function Mounted({
  start = {},
  seen,
  grouped,
  crowded,
  compact = false,
  layers = LAYERS,
  basemaps = BASEMAPS,
  basemapParts = ALL_PARTS,
  context,
  contextAsked,
  zoom,
  boundaries,
}: {
  boundaries?: Parameters<typeof LayerPanel>[0]["boundaries"];
  context?: SceneContext[];
  contextAsked?: SceneContext["id"][];
  zoom?: number;
  start?: MapViewState;
  grouped?: ReadonlySet<string>;
  crowded?: ReadonlySet<string>;
  seen: (view: MapViewState) => void;
  compact?: boolean;
  layers?: SceneLayer[];
  basemaps?: { id: string; name: string }[];
  basemapParts?: { names: boolean; roads: boolean; borders: boolean };
}) {
  const [view, setView] = useState(start);
  const now = useRef(view);
  const change = useCallback(
    (make: MapViewChange) => {
      now.current = make(now.current);
      seen(now.current);
      setView(now.current);
    },
    [seen],
  );
  return (
    <LayerPanel
      layers={layers}
      view={view}
      grouped={grouped}
      crowded={crowded}
      onViewChange={change}
      basemaps={basemaps}
      basemap={view.basemap?.choice ?? basemaps[0]?.id ?? ""}
      basemapParts={basemapParts}
      context={context}
      contextAsked={contextAsked}
      boundaries={boundaries}
      zoom={zoom}
      compact={compact}
    />
  );
}
const mount = (props: Partial<Parameters<typeof Mounted>[0]> = {}) => {
  const seen = vi.fn();
  const view = render(<Mounted seen={seen} {...props} />);
  return { seen, ...view };
};
const list = () => screen.getByRole("list", { name: "Layers of the map" });
const eye = (name: string) => screen.getByRole("button", { name: `Show ${name}` });

describe("the list of layers", () => {
  it("lists the layer on top first, and the layers of a folder under its name", () => {
    mount();
    const names = within(list())
      .getAllByRole("listitem")
      .map((item) => item.querySelector("span[title]")?.getAttribute("title"));
    expect(names).toEqual([
      "Grain elevators with a very long name",
      "Pipelines",
      "Sales",
      "Trade",
      "Density",
      "Imagery",
      "Radar",
      "NDVI",
      "Corn yield",
    ]);
    const folder = screen.getByRole("list", { name: "Imagery" });
    expect(within(folder).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the count of a layer that has marks, and the sign of what it draws", () => {
    mount();
    const items = within(list()).getAllByRole("listitem");
    expect(within(items[0]).getByText("42")).toBeInTheDocument();
    expect(within(items.at(-1) as HTMLElement).getByText("3,100")).toBeInTheDocument();
    expect(within(items[1]).queryByText("0")).toBeNull();
    const signs = [...list().querySelectorAll("[data-swatch]")].map((sign) =>
      sign.getAttribute("data-swatch"),
    );
    expect(signs).toEqual([
      "circle",
      "line",
      "column",
      "arc",
      "heat",
      "raster",
      "raster",
      "fill",
    ]);
    const fill = list().querySelector<HTMLElement>("[data-swatch=fill]");
    expect(fill?.style.background).toContain("linear-gradient");
    const heat = list().querySelector<HTMLElement>("[data-swatch=heat]");
    expect(heat?.style.background).toContain("linear-gradient");
  });

  it("says a layer is on or off as the map and the reader say", () => {
    mount({ start: { hidden: ["points"] } });
    expect(eye("Corn yield").getAttribute("aria-pressed")).toBe("true");
    expect(eye("NDVI").getAttribute("aria-pressed")).toBe("false");
    expect(
      eye("Grain elevators with a very long name").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("hides and shows a layer, each by the rule of its kind", async () => {
    const { seen } = mount();
    await userEvent.click(eye("Corn yield"));
    expect(seen).toHaveBeenLastCalledWith({ hidden: ["regions"] });
    await userEvent.click(eye("NDVI"));
    expect(seen).toHaveBeenLastCalledWith({ hidden: ["regions"], shown: ["ndvi"] });
    await userEvent.click(eye("Corn yield"));
    expect(seen).toHaveBeenLastCalledWith({ shown: ["ndvi"] });
    expect(eye("NDVI").getAttribute("aria-pressed")).toBe("true");
  });

  it("says why a layer is not drawn, and gives it no switch to turn or slider", () => {
    mount();
    expect(screen.getByText("This source is not connected.")).toBeInTheDocument();
    expect(eye("Radar")).toHaveProperty("disabled", true);
    expect(eye("Radar").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("Opacity of Radar")).toBeNull();
  });

  it("shows and hides a whole folder", async () => {
    const { seen } = mount({ start: { shown: ["ndvi"] } });
    const group = screen.getByRole("button", { name: "Show the group Imagery" });
    expect(group.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(group);
    expect(seen).toHaveBeenLastCalledWith({});
    expect(group.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(group);
    expect(seen).toHaveBeenLastCalledWith({ shown: ["ndvi"] });
  });

  it("says so when a map has no layers", () => {
    mount({ layers: [] });
    expect(screen.getByText("This map has no layers.")).toBeInTheDocument();
  });
});

describe("the opacity of a layer", () => {
  const slider = (name: string) =>
    screen.getByLabelText<HTMLInputElement>(`Opacity of ${name}`);

  it("is a slider from 0 to 100 in steps of 5, at what the map and the reader say", () => {
    mount({ start: { opacity: { regions: 0.4 } } });
    expect(slider("Corn yield")).toMatchObject({
      type: "range",
      min: "0",
      max: "100",
      step: "5",
      value: "40",
    });
    expect(slider("NDVI").value).toBe("70");
    expect(slider("Pipelines").value).toBe("100");
    expect(slider("Corn yield").getAttribute("aria-valuetext")).toBe("40%");
  });

  it("stores what the reader chose, and nothing when it is what the map says", () => {
    const { seen } = mount();
    fireEvent.change(slider("Corn yield"), { target: { value: "35" } });
    expect(seen).toHaveBeenLastCalledWith({ opacity: { regions: 0.35 } });
    fireEvent.change(slider("NDVI"), { target: { value: "70" } });
    expect(seen).toHaveBeenLastCalledWith({ opacity: { regions: 0.35 } });
    fireEvent.change(slider("Corn yield"), { target: { value: "100" } });
    expect(seen).toHaveBeenLastCalledWith({});
  });

  it("moves by a step with the arrows, to the ends with Home and End", async () => {
    const { seen } = mount();
    slider("Corn yield").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(seen).toHaveBeenLastCalledWith({ opacity: { regions: 0.95 } });
    await userEvent.keyboard("{ArrowDown}");
    expect(slider("Corn yield").value).toBe("90");
    await userEvent.keyboard("{ArrowRight}{ArrowUp}{ArrowUp}");
    expect(seen).toHaveBeenLastCalledWith({});
    await userEvent.keyboard("{Home}");
    expect(seen).toHaveBeenLastCalledWith({ opacity: { regions: 0 } });
    await userEvent.keyboard("{ArrowLeft}");
    expect(slider("Corn yield").value).toBe("0");
    await userEvent.keyboard("{End}");
    expect(seen).toHaveBeenLastCalledWith({});
  });

  it("opens from the opacity of the row on a small map", async () => {
    mount({ compact: true, start: { opacity: { regions: 0.4 } } });
    expect(screen.queryByLabelText("Opacity of Corn yield")).toBeNull();
    const open = screen.getByRole("button", { name: "Set opacity of Corn yield" });
    expect(open.textContent).toBe("40%");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(slider("Corn yield").value).toBe("40");
    expect(screen.queryByLabelText("Opacity of Pipelines")).toBeNull();
    await userEvent.click(open);
    expect(screen.queryByLabelText("Opacity of Corn yield")).toBeNull();
  });
});

describe("the basemap", () => {
  it("offers the backdrops when there is more than one, and stores one that is not the first", async () => {
    const { seen } = mount();
    const group = screen.getByRole("radiogroup", { name: "Basemap" });
    const [standard, plain] = within(group).getAllByRole<HTMLInputElement>("radio");
    expect(standard.checked).toBe(true);
    await userEvent.click(plain);
    expect(seen).toHaveBeenLastCalledWith({ basemap: { choice: "plain" } });
    expect(plain.checked).toBe(true);
    await userEvent.click(screen.getByLabelText("Standard"));
    expect(seen).toHaveBeenLastCalledWith({});
  });

  it("offers no choice of one backdrop", () => {
    mount({ basemaps: [BASEMAPS[0]] });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByLabelText("Roads")).toBeInTheDocument();
  });

  it("switches the names, the roads and the borders, stored only when off", async () => {
    const { seen } = mount();
    const names = screen.getByLabelText<HTMLInputElement>("Place names");
    expect(names.checked).toBe(true);
    await userEvent.click(names);
    expect(seen).toHaveBeenLastCalledWith({ basemap: { names: false } });
    await userEvent.click(screen.getByLabelText("Borders"));
    expect(seen).toHaveBeenLastCalledWith({
      basemap: { names: false, borders: false },
    });
    await userEvent.click(names);
    expect(seen).toHaveBeenLastCalledWith({ basemap: { borders: false } });
  });

  it("shows only the parts the backdrop has, and no section for a map without a basemap", () => {
    const { unmount } = mount({
      basemapParts: { names: true, roads: false, borders: false },
    });
    expect(screen.getByLabelText("Place names")).toBeInTheDocument();
    expect(screen.queryByLabelText("Roads")).toBeNull();
    expect(screen.queryByLabelText("Borders")).toBeNull();
    unmount();
    mount({
      basemaps: [],
      basemapParts: { names: false, roads: false, borders: false },
    });
    expect(screen.queryByText("Basemap")).toBeNull();
  });
});

describe("the context layers of the basemap", () => {
  const entry = (id: SceneContext["id"], label: string, from: number | null) => ({
    id,
    label,
    from,
    ids: from === null ? [] : [`context-${id}`],
  });
  const BUNDLED: SceneContext[] = [
    entry("buildings", "Buildings", null),
    entry("buildings-3d", "3D buildings", null),
    entry("landuse", "Land use", 0),
    entry("green", "Parks and forest", 2),
    entry("railways", "Railways", null),
    entry("airports", "Airports", 6),
    entry("pois", "Points of interest", null),
  ];
  const DETAILED = BUNDLED.map((item) => ({
    ...item,
    from: item.from ?? 13,
    ids: [`context-${item.id}`],
  }));
  const box = (name: string) => screen.getByLabelText<HTMLInputElement>(name);

  it("is a group of switches under the parts of the basemap, off until one is turned on", async () => {
    const { seen } = mount({ context: DETAILED, zoom: 15 });
    const group = screen.getByRole("group", { name: "Context" });
    expect(
      within(group)
        .getAllByRole<HTMLInputElement>("checkbox")
        .map((input) => [input.checked, input.disabled]),
    ).toEqual(DETAILED.map(() => [false, false]));
    await userEvent.click(box("Buildings"));
    expect(seen).toHaveBeenLastCalledWith({ basemap: { context: ["buildings"] } });
    expect(box("Buildings").checked).toBe(true);
    await userEvent.click(box("Points of interest"));
    expect(seen).toHaveBeenLastCalledWith({
      basemap: { context: ["buildings", "pois"] },
    });
    await userEvent.click(box("Buildings"));
    expect(seen).toHaveBeenLastCalledWith({ basemap: { context: ["pois"] } });
  });

  it("writes what the tiles do not hold in the tone of a disabled label, apart from a switch a reader can use", () => {
    mount({ context: BUNDLED, zoom: 4 });
    const tone = (name: string) => box(name).closest("label")?.className ?? "";
    for (const name of ["Buildings", "Railways"]) {
      expect(tone(name)).toContain("text-general-label-disabled");
      expect(tone(name)).not.toContain("text-ds-text-body");
    }
    expect(tone("Land use")).toContain("text-ds-text-body");
    expect(tone("Land use")).not.toContain("text-general-label-disabled");
  });

  it("lists what the tiles do not hold, disabled, with the reason", async () => {
    const { seen } = mount({ context: BUNDLED, zoom: 4 });
    const reason = screen.getByText("Needs a detailed basemap");
    for (const name of [
      "Buildings",
      "3D buildings",
      "Railways",
      "Points of interest",
    ]) {
      expect(box(name).disabled).toBe(true);
      expect(box(name).checked).toBe(false);
      expect(box(name).getAttribute("aria-describedby")).toBe(reason.id);
      await userEvent.click(box(name));
    }
    expect(seen).not.toHaveBeenCalled();
    expect(box("Land use").disabled).toBe(false);
    expect(box("Parks and forest").disabled).toBe(false);
    const labels = within(screen.getByRole("group", { name: "Context" }))
      .getAllByRole("checkbox")
      .map((input) => input.closest("label")?.textContent);
    expect(labels.slice(0, 3)).toEqual([
      "Land use",
      "Parks and forest",
      "AirportsFrom zoom 6",
    ]);
  });

  it("says from which zoom a layer is drawn while the map is further out", () => {
    const { unmount } = mount({ context: DETAILED, zoom: 9 });
    expect(screen.getAllByText("From zoom 13")).toHaveLength(4);
    expect(box("Land use").closest("label")?.textContent).toBe("Land use");
    unmount();
    mount({ context: DETAILED, zoom: 13 });
    expect(screen.queryByText(/From zoom/)).toBeNull();
    expect(screen.queryByText("Needs a detailed basemap")).toBeNull();
  });

  it("shows what the map asks for as on, and stores it only when the reader turns it off", async () => {
    const { seen } = mount({
      context: DETAILED,
      contextAsked: ["green", "buildings"],
      zoom: 15,
    });
    expect(box("Parks and forest").checked).toBe(true);
    expect(box("Buildings").checked).toBe(true);
    expect(box("Railways").checked).toBe(false);
    await userEvent.click(box("Parks and forest"));
    expect(seen).toHaveBeenLastCalledWith({ basemap: { contextOff: ["green"] } });
    expect(box("Parks and forest").checked).toBe(false);
    await userEvent.click(box("Parks and forest"));
    expect(seen).toHaveBeenLastCalledWith({});
  });

  it("has no group on a backdrop without context layers", () => {
    mount({ context: [] });
    expect(screen.queryByRole("group", { name: "Context" })).toBeNull();
    expect(screen.queryByText("Context")).toBeNull();
  });

  it("is reached with Tab after the parts of the basemap, and Space turns a switch", async () => {
    const { seen } = mount({
      layers: [],
      basemaps: [BASEMAPS[0]],
      context: BUNDLED,
      zoom: 6,
    });
    screen.getByLabelText<HTMLInputElement>("Borders").focus();
    for (const name of ["Land use", "Parks and forest", "Airports"]) {
      await userEvent.tab();
      expect(document.activeElement).toBe(box(name));
    }
    await userEvent.keyboard(" ");
    expect(seen).toHaveBeenLastCalledWith({ basemap: { context: ["airports"] } });
    await userEvent.tab();
    expect((document.activeElement as HTMLElement).tagName).not.toBe("INPUT");
  });
});

describe("the panel with a keyboard", () => {
  it("reaches every control with Tab, and Space turns a switch", async () => {
    const { seen } = mount({ layers: LAYERS.slice(0, 1), basemaps: [BASEMAPS[0]] });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close layers" }),
    );
    const order = [
      eye("Corn yield"),
      screen.getByLabelText("Opacity of Corn yield"),
      ...MAP_BOUNDARIES.map(({ label }) => screen.getByLabelText(label)),
      screen.getByLabelText("Place names"),
      screen.getByLabelText("Roads"),
      screen.getByLabelText("Borders"),
    ];
    for (const control of order) {
      await userEvent.tab();
      expect(document.activeElement).toBe(control);
    }
    eye("Corn yield").focus();
    await userEvent.keyboard(" ");
    expect(seen).toHaveBeenLastCalledWith({ hidden: ["regions"] });
    screen.getByLabelText<HTMLInputElement>("Roads").focus();
    await userEvent.keyboard(" ");
    expect(seen).toHaveBeenLastCalledWith({
      hidden: ["regions"],
      basemap: { roads: false },
    });
  });

  it("closes with Escape and with its close button, keeping the rest of the state", async () => {
    const { seen } = mount({ start: { panel: "open", hidden: ["points"] } });
    eye("Corn yield").focus();
    await userEvent.keyboard("{Escape}");
    expect(seen).toHaveBeenLastCalledWith({ hidden: ["points"] });
    await userEvent.click(screen.getByRole("button", { name: "Close layers" }));
    expect(seen).toHaveBeenLastCalledWith({ hidden: ["points"] });
  });

  it("is a named region with only text nodes for what a map says", () => {
    const hostile = '<img src="https://attacker.example/x.png" onerror="alert(1)">';
    mount({
      layers: [layer("a", { name: hostile, group: hostile, note: hostile })],
    });
    const panel = screen.getByRole("region", { name: "Layers" });
    expect(panel.querySelector("img")).toBeNull();
    expect(within(panel).getAllByText(hostile).length).toBeGreaterThan(1);
  });

  it("says whether it is on a small map or a large one", () => {
    const { unmount } = mount({ compact: true });
    expect(screen.getByRole("region", { name: "Layers" })).toHaveAttribute(
      "data-map-layers",
      "compact",
    );
    unmount();
    mount();
    expect(screen.getByRole("region", { name: "Layers" })).toHaveAttribute(
      "data-map-layers",
      "wide",
    );
  });
});

describe("the close points of a layer of points", () => {
  const SITES = [layer("sites", { name: "Plantations", count: 100, groupable: true })];
  const box = () => screen.getByRole("checkbox", { name: "Group close points" });

  it("has a switch on a layer that can be grouped, and none on any other", () => {
    mount({ layers: SITES, grouped: new Set(["sites"]), crowded: new Set(["sites"]) });
    expect(box()).toBeChecked();
    cleanup();
    mount();
    expect(screen.queryByRole("checkbox", { name: "Group close points" })).toBeNull();
  });

  it("stores that the reader wants the points of a crowded map apart, and nothing when grouped again", async () => {
    const crowded = new Set(["sites"]);
    const { seen, rerender } = mount({ layers: SITES, grouped: crowded, crowded });
    await userEvent.click(box());
    expect(seen).toHaveBeenLastCalledWith({ ungrouped: ["sites"] });
    rerender(
      <Mounted
        seen={seen}
        layers={SITES}
        grouped={new Set()}
        crowded={crowded}
        start={{ ungrouped: ["sites"] }}
      />,
    );
    expect(box()).not.toBeChecked();
  });

  it("groups the points of a map that is not crowded when the reader asks", async () => {
    const { seen } = mount({ layers: SITES, grouped: new Set(), crowded: new Set() });
    await userEvent.click(box());
    expect(seen).toHaveBeenLastCalledWith({ grouped: ["sites"] });
  });
});

describe("the boundary layers of the app in the panel", () => {
  const box = (name: string) => screen.getByLabelText<HTMLInputElement>(name);

  it("lists every layer of the list, off on a map nobody touched", () => {
    mount();
    const group = screen.getByRole("group", { name: "Boundaries" });
    expect(
      within(group)
        .getAllByRole("checkbox")
        .map((input) => (input as HTMLInputElement).checked),
    ).toEqual(MAP_BOUNDARIES.map(() => false));
    for (const { label } of MAP_BOUNDARIES)
      expect(within(group).getByLabelText(label)).toBeInTheDocument();
  });

  it("turns a layer on and off in the view state, in the order of the list", async () => {
    const { seen } = mount();
    await userEvent.click(box("US states"));
    expect(seen).toHaveBeenLastCalledWith({ boundaries: ["us-states"] });
    await userEvent.click(box("Countries"));
    expect(seen).toHaveBeenLastCalledWith({ boundaries: ["countries", "us-states"] });
    expect(box("US states").checked).toBe(true);
    await userEvent.click(box("US states"));
    expect(seen).toHaveBeenLastCalledWith({ boundaries: ["countries"] });
    await userEvent.click(box("Countries"));
    expect(seen).toHaveBeenLastCalledWith({});
  });

  it("says from which zoom a layer that is on is drawn, while the map is further out", () => {
    mount({ start: { boundaries: ["us-counties", "countries"] }, zoom: 2 });
    const group = screen.getByRole("group", { name: "Boundaries" });
    expect(within(group).getByText("From zoom 4")).toBeInTheDocument();
    expect(within(group).getAllByRole("status")).toHaveLength(1);
    cleanup();
    mount({ start: { boundaries: ["us-counties"] }, zoom: 5 });
    expect(screen.queryByText("From zoom 4")).toBeNull();
  });

  it("says that a file is on its way, and that one did not load", () => {
    mount({
      start: { boundaries: ["us-states", "cities"] },
      boundaries: { "us-states": "loading", cities: "failed" },
      zoom: 5,
    });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.getByText("Could not be loaded.")).toBeInTheDocument();
  });
});

describe("what the place that shows a map adds to its panel", () => {
  it("has nothing more on a map of any other place", () => {
    mount({ layers: [] });
    expect(screen.getByText("This map has no layers.")).toBeInTheDocument();
  });

  it("shows the controls and the words of its host under the list of layers", () => {
    render(
      <MapPanelHostContext.Provider
        value={{
          empty: "No data layer yet.",
          actions: <button type="button">Add a map file</button>,
        }}
      >
        <Mounted layers={[]} seen={vi.fn()} />
      </MapPanelHostContext.Provider>,
    );
    expect(screen.getByText("No data layer yet.")).toBeInTheDocument();
    expect(screen.queryByText("This map has no layers.")).toBeNull();
    const add = screen.getByRole("button", { name: "Add a map file" });
    expect(
      add.compareDocumentPosition(screen.getByRole("group", { name: "Boundaries" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
