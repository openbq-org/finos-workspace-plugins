import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MapControls } from "~/components/Geo/MapControls";
import {
  MapBottom,
  MapCredit,
  MapHeading,
  MapLegend,
  scaleEnds,
} from "~/components/Geo/MapParts";
import { MAP_THEMES, mapScale } from "~/components/Geo/mapTheme";

const noop = () => {};

describe("the ends of a scale", () => {
  it("writes a scale of years as years, and any other as before", () => {
    const years = scaleEnds(mapScale(1895, 2020, MAP_THEMES.light), "Year built");
    expect([years.low, years.high]).toEqual(["1895", "2020"]);
    const homes = scaleEnds(mapScale(1895, 2020, MAP_THEMES.light), "Homes");
    expect([homes.low, homes.high]).toEqual(["1,895", "2,020"]);
  });
});

describe("the controls of a map", () => {
  it("have no layers button unless the map can open a panel", () => {
    render(<MapControls onZoom={noop} onReset={noop} />);
    const names = within(screen.getByRole("toolbar", { name: "Map view" }))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Zoom in", "Zoom out", "Reset view"]);
  });

  it("zoom in until the map is as near as it goes: the button then says why, does nothing and keeps the focus", async () => {
    const onZoom = vi.fn();
    const { rerender } = render(<MapControls onZoom={onZoom} onReset={noop} />);
    const plus = screen.getByRole("button", { name: "Zoom in" });
    expect(plus.getAttribute("aria-disabled")).toBe("false");
    await userEvent.click(plus);
    expect(onZoom).toHaveBeenLastCalledWith(1);
    rerender(<MapControls onZoom={onZoom} onReset={noop} zoomEnd />);
    expect(plus.getAttribute("aria-disabled")).toBe("true");
    expect(plus.title).toBe("Zoom in: this map has no more detail closer than this");
    plus.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(plus);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(plus);
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoom).toHaveBeenLastCalledWith(-1);
  });

  it("open and close the layer panel from the last button, which says its state", async () => {
    const onLayers = vi.fn();
    const { rerender } = render(
      <MapControls onZoom={noop} onReset={noop} onExpand={noop} onLayers={onLayers} />,
    );
    const buttons = screen.getAllByRole("button");
    const layers = screen.getByRole("button", { name: "Layers" });
    expect(buttons.at(-1)).toBe(layers);
    expect(layers.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(layers);
    expect(onLayers).toHaveBeenCalledTimes(1);
    layers.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onLayers).toHaveBeenCalledTimes(3);
    rerender(
      <MapControls
        onZoom={noop}
        onReset={noop}
        onExpand={noop}
        onLayers={onLayers}
        layersOpen
      />,
    );
    expect(layers.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the legend of one scale", () => {
  it("is the bar of the scale under what the values are, with its ends", () => {
    render(<MapLegend scale={mapScale(2, 1500, MAP_THEMES.light)} label="Yield" />);
    const legend = screen.getByRole("group", { name: "Legend: Yield" });
    expect(within(legend).getByText("Yield")).toBeInTheDocument();
    expect(within(legend).getByText("2")).toBeInTheDocument();
    expect(within(legend).getByText("1,500")).toBeInTheDocument();
    expect(legend.querySelector<HTMLElement>("[style]")?.style.background).toContain(
      "linear-gradient(to right",
    );
  });
});

describe("the bar at the bottom of a map", () => {
  const bar = (compact: boolean, aside = false) => (
    <MapBottom
      compact={compact}
      slider={<span>slider</span>}
      legend={<span>legend</span>}
      aside={aside ? <span>+33 tags</span> : undefined}
    />
  );
  const order = (root: HTMLElement) =>
    [...root.querySelectorAll("span")].map((part) => part.textContent);

  it("lays the slider over the legend on a small map, and beside it on a wide one, above the credit", () => {
    const { container, rerender } = render(bar(true));
    const root = () => container.firstElementChild as HTMLElement;
    expect(root().dataset.mapBottom).toBe("compact");
    expect(order(root())).toEqual(["slider", "legend"]);
    const parts = () =>
      [...root().querySelectorAll("[data-map-part]")].map((part) => part.textContent);
    expect(parts()).toEqual(["slider", "legend"]);
    rerender(bar(false));
    expect(root().dataset.mapBottom).toBe("wide");
    expect(order(root())).toEqual(["legend", "slider"]);
    expect(parts()).toEqual(["legend", "slider"]);
  });

  it("says at its right end how many tags are not shown", () => {
    const { container, rerender } = render(bar(true, true));
    const root = () => container.firstElementChild as HTMLElement;
    expect(order(root())).toEqual(["slider", "legend", "+33 tags"]);
    rerender(bar(false, true));
    expect(order(root())).toEqual(["legend", "slider", "+33 tags"]);
  });
});

describe("the credit of a map", () => {
  it("is the one link of the basemap when no source is drawn", () => {
    const { container } = render(<MapCredit credit="Protomaps © OpenStreetMap" />);
    const link = screen.getByRole("link", { name: "Protomaps © OpenStreetMap" });
    expect(container.firstElementChild).toBe(link);
    expect(link.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link).toHaveAttribute("data-map-credit");
  });

  it("names the sources that are drawn before it, each once, as text", () => {
    const long = `Synthetic NDVI of the reference backend ${"x".repeat(80)}`;
    const hostile = '<a href="https://attacker.example">USDA</a>';
    const { container } = render(
      <MapCredit
        credit="Protomaps © OpenStreetMap"
        sources={[long, hostile, long, "  "]}
      />,
    );
    expect(screen.getByText(long).getAttribute("title")).toBe(long);
    expect(screen.getByText(hostile)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(
      "https://www.openstreetmap.org/copyright",
    );
    expect(container.querySelectorAll("span[title]")).toHaveLength(2);
    expect(links[0].getAttribute("title")).toBe("Protomaps © OpenStreetMap");
    expect(container.textContent?.indexOf("Synthetic")).toBeLessThan(
      container.textContent?.indexOf("Protomaps") ?? -1,
    );
  });

  it("shows a credit a licence asks for whole, first, however long the others are", () => {
    const long = `Synthetic NDVI of the reference backend ${"x".repeat(80)}`;
    render(
      <MapCredit
        credit="Protomaps © OpenStreetMap"
        sources={[long]}
        required={["Cities: GeoNames, CC BY 4.0"]}
      />,
    );
    const credit = screen.getByText("Cities: GeoNames, CC BY 4.0");
    expect(credit).not.toHaveAttribute("title");
    expect(screen.getByText(long)).toHaveAttribute("title", long);
    const box = credit.closest("[data-map-credit]");
    expect(box?.textContent?.indexOf("Cities: GeoNames")).toBe(0);
    render(<MapCredit credit="" required={["Cities: GeoNames, CC BY 4.0"]} />);
    expect(screen.getAllByText("Cities: GeoNames, CC BY 4.0")).toHaveLength(2);
  });

  it("shows the sources alone on a map without a basemap, and nothing without either", () => {
    const { container, rerender } = render(
      <MapCredit credit="" sources={["USDA NASS"]} />,
    );
    expect(screen.getByText("USDA NASS")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<MapCredit credit="" sources={[]} />);
    expect(container.firstElementChild).toBeNull();
  });
});

describe("the notes over a map", () => {
  const names = (n: number, of: string) =>
    Array.from({ length: n }, (_, at) => `${of} ${at + 1}`).join("; ");
  const UNPLACED = `59 cities are not on the map (the app has no city of that name with 25,000 residents or more): ${names(5, "Town")}; ...`;
  const SEVERAL = `2 city names could be several cities and are not drawn: ${names(2, "Place")}.`;
  const PLAIN = "Street detail needs a detailed basemap.";

  it("say what they count in one line, and every name only when asked", async () => {
    const user = userEvent.setup();
    render(<MapHeading title="Harbours" notes={[UNPLACED, SEVERAL]} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toBe(
      "59 cities are not on the map · 2 city names could be several cities and are not drawn",
    );
    expect(screen.queryByText(/Town 1/)).toBeNull();
    const details = screen.getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    await user.click(details);
    const panel = screen.getByRole("region", { name: "Notes of the map" });
    expect(within(panel).getByText(UNPLACED)).toBeInTheDocument();
    expect(within(panel).getByText(SEVERAL)).toBeInTheDocument();
    expect(details).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Notes of the map" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toHaveFocus();
  });

  it("keep a note that lists nothing whole, with no details to open", () => {
    render(<MapHeading notes={[PLAIN]} />);
    expect(screen.getByRole("status").textContent).toBe(PLAIN);
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("are one line however many names they hold", () => {
    const many = Array.from(
      { length: 8 },
      (_, at) =>
        `${(at + 1) * 1000} places of kind ${at} are not drawn: ${names(5, `Name${at}`)}; ...`,
    );
    render(<MapHeading notes={many} />);
    const line = screen.getByRole("status");
    expect(line.textContent?.split(" · ")).toHaveLength(8);
    expect(line.textContent).not.toMatch(/Name/);
  });
});
