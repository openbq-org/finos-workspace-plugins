import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MapView from "~/components/Geo/MapView";

describe("MapView without WebGL", () => {
  it("says why there is no map and shows the data as a table", () => {
    render(
      <MapView
        name="Rates"
        spec={{
          valueLabel: "Rate (%)",
          points: [
            { lat: 40.7084, lon: -74.0087, label: "New York", tag: "4.0%", value: 4 },
          ],
          regions: { set: "us-states", items: [{ code: "CA", value: 5.5 }] },
          shapes: [
            {
              type: "line",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
              label: "Route",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(
      /cannot draw the map: WebGL/,
    );
    const table = screen.getByRole("table", { name: "Data of map Rates" });
    expect(
      within(table).getByRole("columnheader", { name: "Rate (%)" }),
    ).toBeInTheDocument();
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => row.textContent);
    expect(rows).toEqual([
      "PlaceLabelRate (%)Tag",
      "California (CA)5.5",
      "40.7084, -74.0087New York44.0%",
      "LineRoute",
    ]);
  });

  it("takes no map without marks", () => {
    render(<MapView name="Map" spec={{ points: [], shapes: [] }} />);
    expect(screen.getByRole("alert").textContent).toMatch(
      /^output\.map: the map is empty/,
    );
  });

  it("shows the message of the reducer for what is not a map", () => {
    render(<MapView name="x" spec={{ points: [{ lat: 200, lon: 0 }] }} />);
    expect(screen.getByRole("alert").textContent).toMatch(
      /^output\.map: point 1 has lat 200/,
    );
  });

  it("shows a map of several layers of every kind as a table too", () => {
    render(
      <MapView
        name="Layers"
        view={{ hidden: ["heat-1"], frame: "2024", basemap: { choice: "plain" } }}
        spec={{
          regions: { set: "us-states", items: [{ code: "CA", value: 5.5 }] },
          layers: [
            {
              kind: "points",
              points: [{ lat: 1, lon: 2, label: "Depot", time: "2024" }],
            },
            { kind: "heat", points: [{ lat: 3, lon: 4 }] },
            { kind: "clusters", points: [{ lat: 5, lon: 6 }] },
            { kind: "flows", flows: [{ from: [0, 0], to: [1, 1], label: "Route" }] },
            { kind: "columns", points: [{ lat: 7, lon: 8, value: 2 }] },
            { kind: "source", source: "ndvi" },
            {
              kind: "regions",
              regions: { set: "us-cbsa", items: [{ code: "35620", value: 1 }] },
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/cannot draw the map/);
    const table = screen.getByRole("table", { name: "Data of map Layers" });
    expect(
      within(table)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual([
      "PlaceLabelValueTag",
      "California (CA)5.5",

      "1.0000, 2.0000Depot",
      "3.0000, 4.0000",
      "5.0000, 6.0000",
      "FlowRoute",
      "7.0000, 8.00002",

      "356201",
    ]);
  });
});
