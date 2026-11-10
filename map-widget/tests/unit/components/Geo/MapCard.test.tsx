import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapCard } from "~/components/Geo/MapCard";
import { markNumbers } from "~/components/Geo/markNumbers";
import type { SceneMark } from "~/components/Geo/scene/sceneTypes";

const MARK: SceneMark = {
  kind: "point",
  layer: "points",
  key: "p:40,-100",
  label: "Alpha",
  color: "#123456",
  value: 1234.2,
  tag: "4.2%",
  marker: "star",
  props: { state: "NE", note: null },
  at: [-100, 40],
};
const field = () =>
  screen.getByLabelText("Your tag for this place") as HTMLInputElement;

describe("the card of a mark", () => {
  it("shows the label, the value under its name, the sign, the tag and the other values", () => {
    render(
      <MapCard
        mark={MARK}
        valueLabel="Capacity"
        pinned={false}
        note="mine"
        onClose={vi.fn()}
      />,
    );
    const card = screen.getByRole("group", { name: "Details of Alpha" });
    const pairs = [...card.querySelectorAll("dt")].map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent,
    ]);
    expect(pairs).toEqual([
      ["Capacity", "1,234"],
      ["Marked", "star"],
      ["Tag", "4.2%"],
      ["Your tag", "mine"],
      ["state", "NE"],
      ["note", ""],
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("writes a year as a year and a code with every digit, a quantity as before", () => {
    render(
      <MapCard
        mark={{
          ...MARK,
          value: 1945,
          props: { parcel_id: 10482233, floors: 1250 },
        }}
        valueLabel="Year built"
        pinned={false}
        onClose={vi.fn()}
      />,
    );
    const card = screen.getByRole("group", { name: "Details of Alpha" });
    const shown = Object.fromEntries(
      [...card.querySelectorAll("dt")].map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent,
      ]),
    );
    expect(shown).toMatchObject({
      "Year built": "1945",
      "parcel id": "10482233",
      floors: "1,250",
    });
  });

  it("writes a value as its column was decided for every mark of its layer", () => {
    const other = { ...MARK, key: "b", value: 12, props: { year_opened: 3 } };
    const one = { ...MARK, value: 1931, props: { year_opened: 1999 } };
    render(
      <MapCard
        mark={one}
        valueLabel="year_built"
        numbers={markNumbers([one, other])}
        pinned={false}
        onClose={vi.fn()}
      />,
    );
    const card = screen.getByRole("group", { name: "Details of Alpha" });
    expect(card.textContent).toContain("1,931");
    expect(card.textContent).toContain("1,999");
  });

  it("has no field when the map keeps no tags, or the mark has no place to keep one under", () => {
    const { rerender } = render(<MapCard mark={MARK} pinned onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    rerender(
      <MapCard
        mark={{ ...MARK, key: undefined }}
        pinned
        onNote={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("adds a tag with the button or with Enter, and not one that changes nothing", () => {
    const onNote = vi.fn();
    render(<MapCard mark={MARK} pinned onNote={onNote} onClose={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Add tag" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "depot" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.keyDown(field(), { key: "a" });
    expect(onNote.mock.calls).toEqual([["depot"], ["depot"]]);
  });

  it("opens on the tag the mark has, and empties the field when the tag is removed", () => {
    const onNote = vi.fn();
    render(
      <MapCard mark={MARK} pinned note="depot" onNote={onNote} onClose={vi.fn()} />,
    );
    expect(field().value).toBe("depot");
    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove your tag" }));
    expect(onNote).toHaveBeenCalledWith("");
    expect(field().value).toBe("");
  });

  it("closes with its button when it is pinned", () => {
    const onClose = vi.fn();
    render(<MapCard mark={MARK} pinned onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
