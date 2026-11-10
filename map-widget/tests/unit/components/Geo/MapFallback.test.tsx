import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapFallback from "~/components/Geo/MapFallback";
import { mapSpec } from "~/lib/geo/mapSpec";

const REASON = "The map could not be drawn. The data of the map is in the table.";

describe("the table shown where a map cannot be drawn", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says why, and lists the marks under what their values are", () => {
    const spec = mapSpec({
      valueLabel: "Rate",
      points: [{ lat: 40.5, lon: -90.25, label: "Elevator", value: 3, tag: "Largest" }],
    });
    render(<MapFallback spec={spec} name="Rates" reason={REASON} />);
    expect(screen.getByRole("status").textContent).toBe(REASON);
    const table = screen.getByRole("table", { name: "Data of map Rates" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Place", "Label", "Rate", "Tag"]);
    const cells = within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells.slice(1)).toEqual(["Elevator", "3", "Largest"]);
  });

  it("keeps its four columns apart when the values are called as another column is", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const spec = mapSpec({
      valueLabel: "Label",
      points: [{ lat: 1, lon: 2, value: 5 }],
    });
    render(<MapFallback spec={spec} name="Same" reason={REASON} />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(
      ["Place", "Label", "Label", "Tag"],
    );
    expect(errors).not.toHaveBeenCalled();
  });

  it("renders the first rows of a large map and counts the others", () => {
    const points = Array.from({ length: 1250 }, (_, at) => ({
      lat: 10 + at / 100,
      lon: 20,
      value: at,
    }));
    render(<MapFallback spec={mapSpec({ points })} name="Many" reason={REASON} />);
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(
      screen.getByText("The first 200 of 1,250 marks are shown."),
    ).toBeInTheDocument();
  });

  it("counts nothing for a map of exactly the rows it renders, and one row for one more", () => {
    const table = (count: number) =>
      render(
        <MapFallback
          spec={mapSpec({
            points: Array.from({ length: count }, (_, at) => ({
              lat: 0,
              lon: at / 10,
            })),
          })}
          name="Many"
          reason={REASON}
        />,
      );
    const full = table(200);
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(screen.queryByText(/marks are shown/)).toBeNull();
    full.unmount();
    table(201);
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(
      screen.getByText("The first 200 of 201 marks are shown."),
    ).toBeInTheDocument();
  });

  it("shows text of the data as text, never as markup", () => {
    const ATTACKER = "https://attacker.example";
    const image = `<img src="${ATTACKER}/a.png" onerror="alert(1)">`;
    const link = `<a href="${ATTACKER}/c?d=SECRET">open</a>`;
    const tag = '<a href="//attacker.example">go</a>';
    const spec = mapSpec({
      title: `${image} title`,
      valueLabel: link,
      points: [{ lat: 1, lon: 2, label: image, tag, value: 3 }],
      regions: { set: "us-states", items: [{ code: "CA", value: 5, tag: "<b>x</b>" }] },
    });
    const { container } = render(
      <MapFallback spec={spec} name={image} reason={image} />,
    );
    expect(
      container.querySelector("img, a, b, script, iframe, [href], [src], [onerror]"),
    ).toBeNull();
    const table = screen.getByRole("table", { name: `Data of map ${image}` });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Place", "Label", link, "Tag"]);
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => [...row.children].map((cell) => cell.textContent)),
    ).toEqual([
      ["California (CA)", "", "5", "<b>x</b>"],
      ["1.0000, 2.0000", image, "3", tag],
    ]);
    expect(screen.getByRole("status").textContent).toBe(image);
  });
});

describe("the credit of the data of a map that cannot be drawn", () => {
  it("says whose places the cities are, as the map would", () => {
    render(
      <MapFallback
        spec={mapSpec({ points: [{ lat: 41.85, lon: -87.65 }], credits: ["geonames"] })}
        name="Offices"
        reason={REASON}
      />,
    );
    expect(screen.getByText("Cities: GeoNames, CC BY 4.0")).toBeInTheDocument();
  });
});
