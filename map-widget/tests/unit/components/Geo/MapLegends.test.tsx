import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MapLegends from "~/components/Geo/MapLegends";
import { MapLegend } from "~/components/Geo/MapParts";
import { MAP_THEMES, mapScale } from "~/components/Geo/mapTheme";
import type { SceneLayer } from "~/components/Geo/sceneLayer";

const layer = (id: string, more: Partial<SceneLayer> = {}): SceneLayer => ({
  id,
  name: id,
  kind: "points",
  count: 1,
  parts: [],
  scale: null,
  color: "#ed9b44",
  swatch: "circle",
  ...more,
});
const scale = mapScale(2, 1500, MAP_THEMES.light);
const regions = layer("regions", {
  name: "Corn yield",
  kind: "regions",
  swatch: "fill",
  valueLabel: "Bushels per acre",
  scale,
});
const heat = layer("density", {
  name: "Elevator density",
  kind: "heat",
  swatch: "heat",
  ramp: ["#000004", "#b63679", "#fcfdbf"],
});
const points = layer("points", { name: "Grain elevators" });
const lines = layer("lines", { name: "Rail", swatch: "line" });

const mount = (
  layers: SceneLayer[],
  props: {
    closed?: boolean;
    compact?: boolean;
    categories?: { name: string; color: string }[];
    categoryLabel?: string;
    grouped?: ReadonlySet<string>;
  } = {},
) => {
  const onToggle = vi.fn();
  const view = render(
    <MapLegends
      layers={layers}
      closed={props.closed ?? false}
      compact={props.compact ?? false}
      onToggle={onToggle}
      categories={props.categories}
      categoryLabel={props.categoryLabel}
      grouped={props.grouped}
    />,
  );
  return { onToggle, ...view };
};

describe("the legend of a map of one layer", () => {
  it("is the legend such a map always had: the same markup as one scale", () => {
    const { container } = mount([regions]);
    const before = render(<MapLegend scale={scale} label="Bushels per acre" />);
    expect(container.innerHTML).toBe(before.container.innerHTML);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is the same on a small map: one entry does not wait folded", () => {
    mount([regions], { compact: true });
    expect(
      screen.getByRole("group", { name: "Legend: Bushels per acre" }),
    ).toBeInTheDocument();
  });

  it("shows nothing for a layer of one colour: its name says nothing new", () => {
    const { container } = mount([points]);
    expect(container.firstElementChild).toBeNull();
  });

  it("tells two layers of one name apart by their folder", () => {
    mount([
      layer("a", { name: "Areas", group: "Farms / North", swatch: "fill" }),
      layer("b", { name: "Areas", group: "Farms / South", swatch: "fill" }),
      layer("c", { name: "Points", group: "Farms / South" }),
    ]);
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(within(legend).getByText("Areas (North)")).toBeInTheDocument();
    expect(within(legend).getByText("Areas (South)")).toBeInTheDocument();
    expect(within(legend).getByText("Points")).toBeInTheDocument();
  });

  it("shows a density from sparse to dense", () => {
    mount([heat]);
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(within(legend).getByText("Elevator density")).toBeInTheDocument();
    expect(within(legend).getByText("sparse")).toBeInTheDocument();
    expect(within(legend).getByText("dense")).toBeInTheDocument();
    expect(legend.querySelector<HTMLElement>("[style]")?.style.background).toContain(
      "linear-gradient(to right",
    );
    expect(within(legend).queryByRole("button")).toBeNull();
  });
});

describe("the legend of a map of several layers", () => {
  it("has one entry for each layer, the one on top first", () => {
    mount([regions, heat, lines, points]);
    const legend = screen.getByRole("group", { name: "Legend" });
    const entries = within(legend).getAllByRole("listitem");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "Grain elevators",
      "Rail",
      "Elevator densitysparsedense",
      "Corn yieldBushels per acre21,500",
    ]);
    expect(entries[0].querySelector("[data-swatch=circle]")).toBeTruthy();
    expect(entries[1].querySelector("[data-swatch=line]")).toBeTruthy();
    expect(within(entries[0]).getByText("Grain elevators").getAttribute("title")).toBe(
      "Grain elevators",
    );
  });

  it("does not say twice what the values are when that is the name of the layer", () => {
    mount([{ ...regions, valueLabel: "Corn yield" }, points]);
    expect(screen.getAllByText("Corn yield")).toHaveLength(1);
  });

  it("shows four entries and counts the rest", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => layer(id));
    const { rerender, onToggle } = mount(many);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("+2 more layers")).toBeInTheDocument();
    rerender(
      <MapLegends
        layers={many.slice(0, 5)}
        closed={false}
        compact={false}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText("+1 more layer")).toBeInTheDocument();
  });

  it("keeps the scales when not every layer fits, in the order of the map", () => {
    mount([regions, layer("a"), heat, layer("b"), layer("c"), points]);
    expect(
      screen.getAllByRole("listitem").map((entry) => entry.textContent?.slice(0, 8)),
    ).toEqual(["Grain el", "c", "Elevator", "Corn yie"]);
    expect(screen.getByText("+2 more layers")).toBeInTheDocument();
  });

  it("folds to a small button and unfolds, through the state of the reader", async () => {
    const { onToggle, rerender } = mount([regions, points]);
    const fold = screen.getByRole("button", { name: "Legend" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(fold);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <MapLegends
        layers={[regions, points]}
        closed
        compact={false}
        onToggle={onToggle}
      />,
    );
    expect(screen.queryByRole("group")).toBeNull();
    const chip = screen.getByRole("button", { name: "Legend" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    chip.focus();
    await userEvent.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("is open on a small map when it is short: it is what explains the colours", () => {
    mount([regions, points], { compact: true });
    expect(screen.getByRole("group", { name: "Legend" })).toBeInTheDocument();
    cleanup();
    mount([points], {
      compact: true,
      categoryLabel: "Country",
      categories: ["Colombia", "Ghana", "Indonesia", "Ivory Coast", "Malaysia"].map(
        (name) => ({ name, color: "#ed9b44" }),
      ),
    });
    const key = screen.getByRole("list", { name: "Country" });
    expect(within(key).getAllByRole("listitem")).toHaveLength(5);
  });

  it("names the scale of two layers that measure the same thing once, by what it measures", () => {
    const ghana = { ...regions, id: "gh", name: "Ghana", valueLabel: "Cocoa (tonnes)" };
    const ivory = {
      ...regions,
      id: "ci",
      name: "Ivory Coast",
      valueLabel: "Cocoa (tonnes)",
    };
    mount([ghana, ivory]);
    const legend = screen.getByRole("group", { name: "Legend: Cocoa (tonnes)" });
    expect(legend.textContent).not.toContain("Ghana");
    expect(legend.querySelectorAll("[style*=linear-gradient]")).toHaveLength(1);
  });

  it("says what the circles of grouped points are on a scale", () => {
    mount([regions], { grouped: new Set(["regions"]) });
    expect(
      screen.getByText("Circles: the average of their points"),
    ).toBeInTheDocument();
  });

  it("starts folded on a small map when it is long, and opens there without storing anything", async () => {
    const { onToggle } = mount([regions, heat, points, lines], { compact: true });
    expect(screen.queryByRole("group")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(screen.getByRole("group", { name: "Legend" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("opens a legend the reader folded on a small map, and says so", async () => {
    const { onToggle, rerender } = mount([regions, points], {
      compact: true,
      closed: true,
    });
    await userEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <MapLegends
        layers={[regions, points]}
        closed={false}
        compact
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole("group", { name: "Legend" })).toBeInTheDocument();
  });

  it("opens the folded legend of one scale", async () => {
    const { onToggle } = mount([regions], { closed: true });
    await userEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("names each category of the marks with its colour, also on a map of one plain layer", () => {
    const categories = [
      { name: "corn", color: "#ed9b44" },
      { name: '<img src="https://attacker.example/x.png">', color: "#1f9d8a" },
    ];
    mount([points], { categories, categoryLabel: "crop" });
    const key = within(screen.getByRole("group", { name: "Legend" })).getByRole(
      "list",
      {
        name: "crop",
      },
    );
    expect(
      within(key)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["corn", categories[1].name]);
    expect(key.querySelector("img")).toBeNull();
    expect((key.querySelector("li span") as HTMLElement).style.background).toBe(
      "rgb(237, 155, 68)",
    );
  });

  it("leaves out the entry of a layer that is in the colours of its categories", () => {
    const categories = [
      { name: "corn", color: "#ed9b44" },
      { name: "soy", color: "#1f9d8a" },
    ];
    const fields = layer("fields", {
      name: "Fields",
      swatch: "fill",
      categories: ["#ed9b44", "#1f9d8a"],
    });
    mount([fields, points], { categories, categoryLabel: "crop" });
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(legend.textContent).toContain("Grain elevators");
    expect(legend.textContent).not.toContain("Fields");
    expect(legend.textContent).toContain("soy");
  });

  it("keeps the key of the categories under the scale of a layer, and folds with the legend", async () => {
    const categories = [{ name: "corn", color: "#ed9b44" }];
    const { onToggle } = mount([regions], { categories });
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(legend.textContent).toContain("Corn yield");
    expect(
      within(legend).getByRole("list", { name: "Categories" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Legend" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows what a map says as text only", () => {
    const hostile = '<img src="https://attacker.example/x.png">';
    mount([
      { ...regions, name: hostile, valueLabel: hostile },
      layer("p", { name: hostile }),
    ]);
    const legend = screen.getByRole("group", { name: "Legend" });
    expect(legend.querySelector("img")).toBeNull();
    expect(legend.textContent).toContain(hostile);
  });
});
