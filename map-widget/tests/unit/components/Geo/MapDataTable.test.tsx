import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shownMarks } from "~/components/Geo/applyMapView";
import MapDataTable, { DATA_PAGE_ROWS } from "~/components/Geo/MapDataTable";
import type { MapNotes } from "~/lib/geo/mapNotes";
import { scene } from "./scene/support";

const RAW = {
  valueLabel: "Rate (%)",
  regions: { set: "us-states", items: [{ code: "CA", value: 5.5, tag: "high" }] },
  points: [
    {
      lat: 40.7084,
      lon: -74.0087,
      label: "New York",
      value: 4,
      marker: "star",
      props: { state: "NY", staff: 1200 },
    },
    { lat: 29.76, lon: -95.37, label: "Houston", highlight: true },
  ],
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
};

const mount = (
  raw: unknown = RAW,
  more: {
    notes?: MapNotes;
    onNote?: ((key: string, text: string) => void) | null;
    view?: object;
    frame?: string;
  } = {},
) => {
  const built = scene(raw);
  const onClose = vi.fn();
  const onNote = more.onNote === null ? undefined : (more.onNote ?? vi.fn());
  const view = render(
    <MapDataTable
      name="Rates"
      marks={built.marks}
      shown={shownMarks(built, more.view ?? {}, more.frame)}
      layers={built.layers}
      notes={more.notes ?? {}}
      onNote={onNote}
      onClose={onClose}
      step={more.frame}
    />,
  );
  return { built, onClose, onNote, ...view };
};
const rows = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      [...row.children].map(
        (cell) => (cell.firstChild as HTMLElement)?.textContent ?? "",
      ),
    );
const headings = () =>
  screen.getAllByRole("columnheader").map((heading) => heading.textContent);

describe("the numbers of the data of a map", () => {
  it("writes a year as a year and a code with every digit, a quantity as before", () => {
    mount({
      valueLabel: "year_built",
      points: [
        {
          lat: 40.7484,
          lon: -73.9857,
          label: "Empire State Building",
          value: 1931,
          props: { parcel_id: 10482233, visitors: 4000 },
        },
      ],
    });
    expect(rows()).toEqual([
      [
        "Empire State Building",
        "40.7484, -73.9857",
        "1931",
        "parcel id: 10482233; visitors: 4,000",
        "Add tag",
      ],
    ]);
  });

  it("writes every row of a column the same way: one value that is no year makes quantities", () => {
    mount({
      valueLabel: "year_built",
      points: [
        { lat: 40, lon: -73, label: "A", value: 1931, props: { fiscal_year: 2020 } },
        { lat: 41, lon: -73, label: "B", value: 12, props: { fiscal_year: 2021 } },
      ],
    });
    const [, first, second] = screen.getAllByRole("row");
    expect(first.textContent).toContain("1,931");
    expect(second.textContent).toContain("12");
    expect(first.textContent).toContain("fiscal year: 2020");
    expect(second.textContent).toContain("fiscal year: 2021");
  });
});

describe("the header of the data of a map", () => {
  it("is the table alone: no visible title, no export and no button back, which the controls and the widget have", () => {
    mount({ points: [{ lat: 1, lon: 2, label: "A" }] });
    expect(
      screen.queryByRole("group", { name: "Export the map as a file" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Show map" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Data of the map" })).toHaveClass(
      "sr-only",
    );
  });
});

describe("the marks of a map as a table", () => {
  it("keeps canonical region codes so counties with the same label remain distinguishable", () => {
    mount(
      {
        regions: {
          set: "us-counties",
          items: [
            { code: "01015", label: "Calhoun", value: 71.7 },
            { code: "19025", label: "Calhoun", value: 205.3 },
          ],
        },
      },
      { onNote: null },
    );
    expect(screen.getByRole("columnheader", { name: "Region code" })).toBeVisible();
    expect(screen.getByRole("row", { name: "Calhoun 01015 71.7" })).toBeVisible();
    expect(screen.getByRole("row", { name: "Calhoun 19025 205.3" })).toBeVisible();
  });

  it("lists every mark with its layer, label, place, value, tag, sign and other values", () => {
    mount();
    expect(
      screen.getByRole("region", { name: "Data of map Rates" }),
    ).toBeInTheDocument();
    expect(headings()).toEqual([
      "Layer",
      "Label",
      "Region code",
      "Place",
      "Rate (%)",
      "Tag",
      "Marker",
      "Other values",
      "Your tag",
    ]);
    expect(rows()).toEqual([
      ["Rate (%)", "California", "06", "", "5.5", "high", "", "", "Add tag"],
      ["Lines", "Route", "", "", "", "", "", "", ""],
      [
        "Points",
        "New York",
        "",
        "40.7084, -74.0087",
        "4",
        "",
        "star",
        "state: NY; staff: 1,200",
        "Add tag",
      ],
      [
        "Points",
        "Houston",
        "",
        "29.7600, -95.3700",
        "",
        "",
        "highlight",
        "",
        "Add tag",
      ],
    ]);
    expect(screen.getByRole("rowheader", { name: "New York" })).toBeInTheDocument();
  });

  it("leaves the layer out on a map of one layer, and names the values by their layer", () => {
    mount({ points: [{ lat: 1, lon: 2, label: "Alpha", value: 3 }] });
    expect(headings()).toEqual(["Label", "Place", "Value", "Your tag"]);
  });

  it("has no column for the tags of the user on a map that keeps none", () => {
    mount({ points: [{ lat: 1, lon: 2, label: "Alpha" }] }, { onNote: null });
    expect(headings()).toEqual(["Label", "Place"]);
  });

  it("lists the points of a density layer, which the map shows and no pointer reads", () => {
    const built = scene({
      layers: [
        {
          id: "incidents",
          kind: "heat",
          points: [
            {
              lat: 4,
              lon: 3,
              label: "Piracy",
              time: "2025-11",
              props: { severity: 4 },
            },
            { lat: 5, lon: 3, label: "Theft", time: "2025-12" },
          ],
        },
      ],
    });
    expect(built.marks).toEqual([]);
    expect(built.listed.map((mark) => mark.label)).toEqual(["Piracy", "Theft"]);
    render(
      <MapDataTable
        name="Incidents"
        marks={built.listed}
        shown={shownMarks(built, {}, "2025-11")}
        layers={built.layers}
        notes={{}}
        onNote={vi.fn()}
        onClose={vi.fn()}
        step="2025-11"
      />,
    );
    expect(rows()).toEqual([["Piracy", "4.0000, 3.0000", "severity: 4", ""]]);
    expect(screen.queryByRole("button", { name: /Add tag/ })).toBeNull();
  });

  it("lists what is on the map as the reader has it: the layers that are shown, on the step of the map", () => {
    const timed = {
      layers: [
        {
          id: "sites",
          kind: "points",
          points: [
            { lat: 1, lon: 1, label: "Then", time: "2023" },
            { lat: 2, lon: 2, label: "Now", time: "2024" },
            { lat: 3, lon: 3, label: "Always" },
          ],
        },
        { id: "off", kind: "points", points: [{ lat: 4, lon: 4, label: "Hidden" }] },
      ],
    };
    mount(timed, { view: { hidden: ["off"] }, frame: "2024" });
    expect(rows().map((row) => row[0])).toEqual(["Now", "Always"]);
    expect(screen.getByRole("heading").textContent).toBe("Data of the map at 2024");
  });

  it("says so when no mark is on the map as it is shown", () => {
    mount({ points: [{ lat: 1, lon: 1 }] }, { view: { hidden: ["points"] } });
    expect(screen.getByRole("status").textContent).toBe(
      "No mark is on the map as it is shown.",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows markup in a label as the text it is", () => {
    const hostile = '<img src="https://attacker.example/x.png" onerror="alert(1)">';
    const { container } = mount({
      points: [{ lat: 1, lon: 2, label: hostile, tag: hostile, props: { a: hostile } }],
    });
    expect(container.querySelector("img, a, script, iframe")).toBeNull();
    expect(container.textContent).toContain(hostile);
  });
});

describe("the pages of a long table", () => {
  const many = {
    points: Array.from({ length: 2 * DATA_PAGE_ROWS + 30 }, (_, at) => ({
      lat: 0,
      lon: at / 100,
      label: `P${at}`,
    })),
  };
  const first = () => rows()[0][0];

  it("shows a page of the marks and steps through all of them", () => {
    mount(many);
    expect(rows()).toHaveLength(DATA_PAGE_ROWS);
    expect(screen.getByRole("status").textContent).toBe("Marks 1 to 100 of 230");
    const previous = screen.getByRole("button", {
      name: "Previous",
    }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    fireEvent.click(next);
    expect(first()).toBe("P100");
    fireEvent.click(next);
    expect(first()).toBe("P200");
    expect(rows()).toHaveLength(30);
    expect(screen.getByRole("status").textContent).toBe("Marks 201 to 230 of 230");
    expect(next.disabled).toBe(true);
    fireEvent.click(previous);
    expect(first()).toBe("P100");
  });

  it("has no buttons of pages for a table of one page", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  const points = (count: number) => ({
    points: Array.from({ length: count }, (_, at) => ({
      lat: 0,
      lon: at / 100,
      label: `P${at}`,
    })),
  });

  it("is one page with no buttons at exactly a page of marks", () => {
    mount(points(DATA_PAGE_ROWS));
    expect(rows()).toHaveLength(DATA_PAGE_ROWS);
    expect(rows().at(-1)?.[0]).toBe(`P${DATA_PAGE_ROWS - 1}`);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is two pages at one mark more than a page", () => {
    mount(points(DATA_PAGE_ROWS + 1));
    expect(rows()).toHaveLength(DATA_PAGE_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rows().map((row) => row[0])).toEqual([`P${DATA_PAGE_ROWS}`]);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("is two full pages and no third at exactly two pages of marks", () => {
    mount(points(2 * DATA_PAGE_ROWS));
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(rows()).toHaveLength(DATA_PAGE_ROWS);
    expect(first()).toBe(`P${DATA_PAGE_ROWS}`);
    expect(screen.getByRole("status").textContent).toBe(
      `Marks ${DATA_PAGE_ROWS + 1} to ${2 * DATA_PAGE_ROWS} of ${2 * DATA_PAGE_ROWS}`,
    );
    expect(next).toBeDisabled();
  });

  it("goes to the last page there is when the marks become fewer than the page that is open", () => {
    const built = scene(many);
    const table = (count: number) => (
      <MapDataTable
        name="Rates"
        marks={built.marks}
        shown={(mark) => built.marks.indexOf(mark) < count}
        layers={built.layers}
        notes={{}}
        onClose={vi.fn()}
      />
    );
    const view = render(table(many.points.length));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(first()).toBe(`P${2 * DATA_PAGE_ROWS}`);
    view.rerender(table(DATA_PAGE_ROWS + 50));
    expect(rows()).toHaveLength(50);
    expect(first()).toBe(`P${DATA_PAGE_ROWS}`);
    expect(screen.getByRole("status").textContent).toBe(
      `Marks ${DATA_PAGE_ROWS + 1} to ${DATA_PAGE_ROWS + 50} of ${DATA_PAGE_ROWS + 50}`,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    view.rerender(table(4));
    expect(rows().map((row) => row[0])).toEqual(["P0", "P1", "P2", "P3"]);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("does not carry a tag that was typed to the row at the same place of the next page", () => {
    mount(many);
    fireEvent.click(screen.getByRole("button", { name: "Add tag to P0" }));
    fireEvent.change(screen.getByLabelText("Your tag for P0"), {
      target: { value: "only for P0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Add tag to P100" })).toBeInTheDocument();
  });
});

describe("the tag of the user in a row", () => {
  const key = (built: ReturnType<typeof scene>, label: string) =>
    built.marks.find((mark) => mark.label === label)?.key as string;

  it("is added with the button of the row and Enter, under the key of that mark", () => {
    const { built, onNote } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Add tag to Houston" }));
    const field = screen.getByLabelText("Your tag for Houston");
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "depot" } });
    const unhandled = fireEvent.keyDown(field, { key: "Enter" });
    expect(unhandled, "the browser must not press the button that takes the focus").toBe(false);
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledWith(key(built, "Houston"), "depot");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add tag to Houston" }),
    );
  });

  it("is shown, changed with Save and removed", () => {
    const built = scene(RAW);
    const { onNote } = mount(RAW, { notes: { [key(built, "New York")]: "office" } });
    const row = screen.getByRole("rowheader", { name: "New York" }).closest("tr");
    expect(within(row as HTMLElement).getByText("office")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change the tag of New York" }));
    const field = screen.getByLabelText<HTMLInputElement>("Your tag for New York");
    expect(field.value).toBe("office");
    fireEvent.change(field, { target: { value: "head office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onNote).toHaveBeenLastCalledWith(key(built, "New York"), "head office");
    fireEvent.click(screen.getByRole("button", { name: "Change the tag of New York" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the tag of New York" }));
    expect(onNote).toHaveBeenLastCalledWith(key(built, "New York"), "");
  });

  it("is left as it was at Cancel and at Escape, and Escape in the field keeps the table open", () => {
    const { onNote, onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Add tag to Houston" }));
    fireEvent.change(screen.getByLabelText("Your tag for Houston"), {
      target: { value: "x" },
    });
    fireEvent.keyDown(screen.getByLabelText("Your tag for Houston"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add tag to Houston" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onNote).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has no button where the map keeps no tags, and none for a mark without a place to keep one under", () => {
    const built = scene(RAW);
    mount(RAW, { onNote: null, notes: { [key(built, "Houston")]: "seen" } });
    expect(screen.queryByRole("button", { name: /tag/i })).toBeNull();
    expect(screen.getByText("seen")).toBeInTheDocument();
    render(<div data-testid="split" />);
    mount();
    expect(screen.queryByRole("button", { name: "Add tag to Route" })).toBeNull();
  });
});

describe("leaving the table", () => {
  it("takes the focus when it opens and returns to the map with Escape", () => {
    const { onClose } = mount();
    expect(document.activeElement).toBe(screen.getByRole("heading"));
    fireEvent.keyDown(screen.getByRole("table"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the credit under the data of a map", () => {
  it("says whose places the cities are while the table is shown in place of the map", () => {
    const built = scene(RAW);
    render(
      <MapDataTable
        name="Offices"
        marks={built.marks}
        shown={shownMarks(built, {}, undefined)}
        layers={built.layers}
        notes={{}}
        onClose={vi.fn()}
        credits={["Cities: GeoNames, CC BY 4.0"]}
      />,
    );
    expect(screen.getByText("Cities: GeoNames, CC BY 4.0")).toBeInTheDocument();
  });
});
