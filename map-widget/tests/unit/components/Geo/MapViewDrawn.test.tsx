import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "~/components/Geo/MapView";
import { LIVE_MAPS } from "~/components/Geo/mapBudget";
import { CONTEXT_RESTORE_MS } from "~/components/Geo/useLibraryMap";
import { expectNoUseAfterRemove, FakeMap, fakeLibrary } from "./fakeMap";
import { sets, states, world } from "./scene/support";

afterEach(expectNoUseAfterRemove);

const loaded = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("~/components/Geo/useMapData", () => ({
  useMapData: () => loaded.data,
  useBasemap: () => null,
  useHeldArchives: () => true,
}));
vi.mock("~/components/Geo/mapLibrary", () => ({ canDrawMaps: () => true }));
vi.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ width: 900, height: 500, ref: { current: null } }),
}));

class Observer {
  static made: Observer[] = [];
  constructor(private readonly tell: (entries: { isIntersecting: boolean }[]) => void) {
    Observer.made.push(this);
  }
  observe() {}
  disconnect() {}
  see(isIntersecting: boolean) {
    act(() => this.tell([{ isIntersecting }]));
  }
}

const see = (map: number, where: "view" | "near" | "far") => {
  Observer.made[2 * map].see(where !== "far");
  Observer.made[2 * map + 1].see(where === "view");
};

const SPEC = {
  title: "Sites",

  points: [{ lat: -20, lon: 30, label: "Alpha", tag: "first" }],
};
const drawn = () => FakeMap.made.filter((map) => !map.remove.mock.calls.length);
let urls: string[] = [];
let revoked: string[] = [];

const settle = async () => {
  for (const map of drawn()) if (!map.loaded()) act(() => map.settle());
  await act(async () => {});
  await act(async () => {});
};

const settleAll = async () => {
  for (let round = 0; round < 80; round++) {
    const before = FakeMap.made.length + revoked.length + urls.length;
    await settle();
    if (FakeMap.made.length + revoked.length + urls.length === before) return;
  }
};
const many = (count: number) =>
  render(
    <div>
      {Array.from({ length: count }, (_, at) => (
        <div key={at} data-testid={`map-${at}`} className="flex flex-col">
          <MapView spec={{ ...SPEC, title: `Map ${at}` }} name="Answer" />
        </div>
      ))}
    </div>,
  );
const box = (at: number) => screen.getByTestId(`map-${at}`);
const shows = (at: number) =>
  box(at).querySelector("canvas")
    ? "map"
    : box(at).querySelector("img[data-map-still]")
      ? "still"
      : box(at).querySelector("[data-map-placeholder]")
        ? "placeholder"
        : "nothing";

const buttons = (at: number) =>
  within(box(at))
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
const CONTROLS = [
  "Zoom in",
  "Zoom out",
  "Reset view",
  "Layers",
  "Measure",
  "Show data",
  "Export map",
];

beforeEach(() => {
  FakeMap.reset();
  Observer.made = [];
  urls = [];
  revoked = [];
  loaded.data = { lib: fakeLibrary(), world, states, sets };
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => {
      const url = `blob:still/${urls.length}`;
      urls.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) =>
    done(new Blob(["png"], { type: "image/png" })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("when a map is drawn", () => {
  it("shows its title and makes no map until it is near what is on screen", () => {
    render(<MapView spec={SPEC} name="Answer" />);
    expect(FakeMap.made).toHaveLength(0);
    const waiting = screen.getByRole("group", { name: "Map Sites" });
    expect(waiting.getAttribute("aria-busy")).toBe("false");
    see(0, "near");
    expect(FakeMap.made).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Map Sites" })).toBeNull();
  });

  it("is named by what shows it when the map has no title", () => {
    render(<MapView spec={{ points: SPEC.points }} name="Answer" />);
    expect(screen.getByRole("group", { name: "Map Answer" })).toBeInTheDocument();
  });

  it("gives its context back far from the screen and is drawn again when the reader scrolls back, with no click", async () => {
    const count = LIVE_MAPS + 6;
    many(count);

    for (let at = 0; at < count; at++) {
      see(at, "view");
      if (at > 0) see(at - 1, "far");
      await settleAll();
      expect(drawn().length).toBeLessThanOrEqual(LIVE_MAPS);
    }
    expect(shows(count - 1)).toBe("map");

    expect(shows(0)).toBe("still");
    see(count - 1, "far");
    see(0, "view");
    await settleAll();
    expect(shows(0)).toBe("map");
    expect(drawn().length).toBeLessThanOrEqual(LIVE_MAPS);

    expect(buttons(0)).toEqual(CONTROLS);
  });
});

describe("more maps in view than may hold a context", () => {
  const count = LIVE_MAPS + 5;
  const inView = async () => {
    many(count);
    for (let at = 0; at < count; at++) see(at, "view");
  };

  it("shows every one of them without a click: the budget of drawn maps, and a still of each other one", async () => {
    await inView();

    expect(drawn()).toHaveLength(LIVE_MAPS);
    const waiting = box(count - 1).querySelector("[data-map-placeholder]");
    expect(waiting?.getAttribute("data-map-placeholder")).toBe("loading");

    expect(waiting?.textContent).toBe(`Map ${count - 1}Loading the map...`);
    expect(within(box(count - 1)).queryAllByRole("button")).toEqual([]);
    let most = 0;
    for (let round = 0; round < 80; round++) {
      const before = urls.length + FakeMap.made.length;
      await settle();
      most = Math.max(most, drawn().length);
      if (urls.length + FakeMap.made.length === before) break;
    }

    expect(most).toBeLessThanOrEqual(LIVE_MAPS);
    const all = Array.from({ length: count }, (_, at) => shows(at));
    expect(all.filter((kind) => kind === "map")).toHaveLength(LIVE_MAPS);
    expect(all.filter((kind) => kind === "still")).toHaveLength(count - LIVE_MAPS);

    for (let at = 0; at < count; at++)
      expect(buttons(at), `map ${at}`).toEqual(CONTROLS);
  });

  it("keeps what is markup over the still: the name, the title, the controls and the tags where they were", async () => {
    await inView();
    await settleAll();
    const still = Array.from({ length: count }, (_, at) => at).find(
      (at) => shows(at) === "still",
    ) as number;
    const view = within(box(still));

    expect(
      view.getByRole("group", { name: /^Map Answer: 1 point/ }),
    ).toBeInTheDocument();
    expect(view.getByText(`Map ${still}`)).toBeInTheDocument();
    expect(view.getByRole("toolbar", { name: "Map view" })).toBeInTheDocument();

    const tag = [...box(still).querySelectorAll("[aria-hidden] > span")].find(
      (chip) => chip.textContent === "first",
    ) as HTMLElement;
    expect(tag.style.transform).toMatch(/^translate\(/);
    const image = box(still).querySelector("img[data-map-still]") as HTMLImageElement;
    expect(image.getAttribute("src")).toMatch(/^blob:still\//);
    expect(image.getAttribute("alt")).toBe("");
  });

  it("shows the data of a still as a table without a context for it", async () => {
    await inView();
    await settleAll();
    const still = Array.from({ length: count }, (_, at) => at).find(
      (at) => shows(at) === "still",
    ) as number;
    const made = FakeMap.made.length;
    fireEvent.click(within(box(still)).getByRole("button", { name: "Show data" }));
    expect(
      within(box(still)).getByRole("region", { name: "Data of map Answer" }),
    ).toBeInTheDocument();
    expect(
      within(box(still)).getByRole("rowheader", { name: "Alpha" }),
    ).toBeInTheDocument();
    expect(FakeMap.made).toHaveLength(made);
  });

  it("draws the still the reader focuses, and the map used longest ago turns into its still: nothing is blank on the way", async () => {
    await inView();
    await settleAll();
    const kinds = () => Array.from({ length: count }, (_, at) => shows(at));
    const still = kinds().indexOf("still");
    act(
      () =>
        void box(still).firstElementChild?.dispatchEvent(
          new FocusEvent("focusin", { bubbles: true }),
        ),
    );

    expect(kinds()).not.toContain("nothing");
    expect(kinds()).not.toContain("placeholder");
    expect(drawn().length).toBeLessThanOrEqual(LIVE_MAPS);
    await settleAll();
    expect(shows(still)).toBe("map");
    expect(kinds().filter((kind) => kind === "map")).toHaveLength(LIVE_MAPS);
    expect(kinds().filter((kind) => kind === "still")).toHaveLength(count - LIVE_MAPS);
    expect(kinds()).not.toContain("nothing");
    expect(kinds()).not.toContain("placeholder");

    expect(box(still).querySelector("img[data-map-still]")).toBeNull();
  });

  it("shows the still of a map that gives its context back before the canvas of the map goes", async () => {
    await inView();
    await settleAll();
    const kinds = () => Array.from({ length: count }, (_, at) => shows(at));

    const left: (string | null)[] = [];
    for (const map of drawn())
      map.remove.mockImplementation(() => {
        const box = map.container.closest("[data-testid]");
        left.push(box?.querySelector("img[data-map-still]") ? "still" : null);
        map.canvas.remove();
      });

    const still = kinds().indexOf("still");
    act(
      () =>
        void box(still).firstElementChild?.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        ),
    );
    await settleAll();
    expect(left.length).toBeGreaterThanOrEqual(1);

    expect(left).not.toContain(null);
  });

  it("draws a map under its still until the map is idle", async () => {
    await inView();
    await settleAll();
    const still = Array.from({ length: count }, (_, at) => shows(at)).indexOf("still");
    act(
      () =>
        void box(still).firstElementChild?.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        ),
    );

    await act(async () => {});

    const fresh = drawn().find((map) => box(still).contains(map.canvas));
    expect(fresh).toBeDefined();
    expect(fresh?.loaded()).toBe(false);

    expect(box(still).querySelector("canvas")).not.toBeNull();
    expect(box(still).querySelector("img[data-map-still]")).not.toBeNull();
    await settle();
    expect(shows(still)).toBe("map");
    expect(box(still).querySelector("img[data-map-still]")).toBeNull();
  });
});

describe("the picture of a still", () => {
  it("is an address of the page that is given back when the view goes, and none is left", async () => {
    const count = LIVE_MAPS + 3;
    const view = many(count);
    for (let at = 0; at < count; at++) see(at, "view");
    await settleAll();
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const url of urls) expect(url).toMatch(/^blob:/);
    view.unmount();
    expect([...revoked].sort()).toEqual([...urls].sort());
  });

  it("stays in the view: nothing of it is handed to who stores the view state or the tags", async () => {
    const onViewChange = vi.fn();
    const onNotesChange = vi.fn();
    render(
      <div>
        {Array.from({ length: LIVE_MAPS + 2 }, (_, at) => (
          <div key={at} data-testid={`map-${at}`} className="flex flex-col">
            <MapView
              spec={SPEC}
              name="Answer"
              view={{}}
              onViewChange={onViewChange}
              onNotesChange={onNotesChange}
            />
          </div>
        ))}
      </div>,
    );
    for (let at = 0; at < LIVE_MAPS + 2; at++) see(at, "view");
    await settleAll();
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(onViewChange).not.toHaveBeenCalled();
    expect(onNotesChange).not.toHaveBeenCalled();
  });

  it("is taken again when the map changes, and the one before is given back", async () => {
    const view = render(
      <div>
        {Array.from({ length: LIVE_MAPS + 1 }, (_, at) => (
          <div key={at} data-testid={`map-${at}`} className="flex flex-col">
            <MapView spec={SPEC} name="Answer" />
          </div>
        ))}
      </div>,
    );
    for (let at = 0; at <= LIVE_MAPS; at++) see(at, "view");
    await settleAll();
    const first = urls.length;
    expect(first).toBeGreaterThanOrEqual(1);
    const other = { ...SPEC, points: [{ lat: 30, lon: -90, label: "Beta" }] };
    view.rerender(
      <div>
        {Array.from({ length: LIVE_MAPS + 1 }, (_, at) => (
          <div key={at} data-testid={`map-${at}`} className="flex flex-col">
            <MapView spec={other} name="Answer" />
          </div>
        ))}
      </div>,
    );
    await settleAll();
    expect(urls.length).toBeGreaterThan(first);

    const shown = [...document.querySelectorAll("img[data-map-still]")].map((image) =>
      image.getAttribute("src"),
    );
    const held = urls.filter((url) => !revoked.includes(url));
    expect(shown.length).toBeGreaterThanOrEqual(1);
    for (const url of shown) expect(held).toContain(url);
    expect(held.length).toBeLessThanOrEqual(LIVE_MAPS + 1);
    expect(revoked.length).toBeGreaterThanOrEqual(1);
    view.unmount();
    expect([...revoked].sort()).toEqual([...urls].sort());
  });
});

describe("a map that comes back", () => {
  it("is as the reader left it, on a map nobody stores", async () => {
    many(LIVE_MAPS + 1);
    const first = within(box(0));

    const eye = () => first.getByRole("button", { name: "Show Map 0" });
    see(0, "view");
    await settle();
    fireEvent.click(first.getByRole("button", { name: "Layers" }));
    fireEvent.click(eye());
    see(0, "far");
    for (let at = 1; at <= LIVE_MAPS; at++) see(at, "view");
    await settleAll();
    expect(shows(0)).not.toBe("map");
    for (let at = 1; at <= LIVE_MAPS; at++) see(at, "far");
    see(0, "view");
    await settleAll();
    expect(shows(0)).toBe("map");

    expect(first.queryByRole("region", { name: "Layers" })).toBeNull();
    fireEvent.click(first.getByRole("button", { name: "Layers" }));
    expect(eye().getAttribute("aria-pressed")).toBe("false");
  });

  it("looks where the reader left it, not at its data again", async () => {
    many(LIVE_MAPS + 1);
    see(0, "view");
    await settle();
    const [map] = FakeMap.made;

    map.center = [-90, 35];
    map.zoom = 6.5;
    act(() => {
      map.fire("dragstart", { originalEvent: {} });
      map.fire("moveend");
    });
    see(0, "far");
    for (let at = 1; at <= LIVE_MAPS; at++) see(at, "view");
    await settleAll();
    for (let at = 1; at <= LIVE_MAPS; at++) see(at, "far");
    see(0, "view");
    await settleAll();
    const again = drawn().find((made) => box(0).contains(made.canvas)) as FakeMap;
    expect(again).not.toBe(map);
    expect(again.jumpTo).toHaveBeenCalledWith({
      center: [-90, 35],
      zoom: 6.5,
      bearing: 0,
      pitch: 0,
    });
    expect(again.fitBounds).not.toHaveBeenCalled();

    fireEvent.click(within(box(0)).getByRole("button", { name: "Reset view" }));
    expect(again.fitBounds).toHaveBeenCalledTimes(1);
  });
});

describe("a drawn map that has a still and is moved", () => {
  const count = LIVE_MAPS + 1;
  const tagOf = (at: number) =>
    [...box(at).querySelectorAll("[aria-hidden] > span")].find(
      (chip) => chip.textContent === "first",
    ) as HTMLElement;
  const touch = (at: number) =>
    act(
      () =>
        void box(at).firstElementChild?.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        ),
    );

  it("takes a new still before it gives its context back: the picture and the tags are where the reader left the map", async () => {
    many(count);
    for (let at = 0; at < count; at++) see(at, "view");
    await settleAll();

    const moved = Array.from({ length: count }, (_, at) => shows(at)).indexOf("still");
    const opening = box(moved)
      .querySelector("img[data-map-still]")
      ?.getAttribute("src");
    const tagBefore = tagOf(moved).style.transform;

    touch(moved);
    await settleAll();
    expect(shows(moved)).toBe("map");
    const map = drawn().find((made) => box(moved).contains(made.canvas)) as FakeMap;

    map.center = [-90, 35];
    map.origin = { x: 120, y: 60 };
    act(() => {
      map.fire("dragstart", { originalEvent: {} });
      map.fire("move");
      map.fire("moveend");
    });
    const tagMoved = tagOf(moved).style.transform;
    expect(tagMoved).not.toBe(tagBefore);

    const taken = urls.length;
    for (let at = 0; at < count; at++)
      if (at !== moved) {
        touch(at);
        await settleAll();
      }
    expect(shows(moved)).toBe("still");

    const shown = box(moved).querySelector("img[data-map-still]")?.getAttribute("src");
    expect(shown).not.toBe(opening);
    expect(urls.indexOf(shown as string)).toBeGreaterThanOrEqual(taken);
    expect(revoked).toContain(opening);
    expect(tagOf(moved).style.transform).toBe(tagMoved);
  });

  it("keeps the still it has when nobody moved it", async () => {
    many(count);
    for (let at = 0; at < count; at++) see(at, "view");
    await settleAll();
    const used = Array.from({ length: count }, (_, at) => shows(at)).indexOf("still");
    const opening = box(used).querySelector("img[data-map-still]")?.getAttribute("src");
    touch(used);
    await settleAll();
    for (let at = 0; at < count; at++)
      if (at !== used) {
        touch(at);
        await settleAll();
      }
    expect(shows(used)).toBe("still");
    expect(box(used).querySelector("img[data-map-still]")?.getAttribute("src")).toBe(
      opening,
    );
  });
});

describe("a map whose graphics context the browser took", () => {
  const lose = (map: FakeMap) =>
    act(() => void map.canvas.dispatchEvent(new Event("webglcontextlost")));
  const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const mount = () => {
    vi.useFakeTimers();
    const view = render(<MapView spec={SPEC} name="Answer" />);
    see(0, "view");
    return view;
  };

  it("stays as it is when the context comes back in time: the library draws again", () => {
    mount();
    const [map] = FakeMap.made;
    lose(map);
    pass(CONTEXT_RESTORE_MS - 100);
    act(() => void map.canvas.dispatchEvent(new Event("webglcontextrestored")));
    pass(CONTEXT_RESTORE_MS);
    expect(FakeMap.made).toHaveLength(1);
    expect(map.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is drawn anew once when the context does not come back", () => {
    mount();
    const [map] = FakeMap.made;
    lose(map);
    pass(CONTEXT_RESTORE_MS - 1);
    expect(FakeMap.made).toHaveLength(1);
    pass(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(FakeMap.made).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows its data with a way to try again when the new one is lost too", () => {
    mount();
    lose(FakeMap.made[0]);
    pass(CONTEXT_RESTORE_MS);
    lose(FakeMap.made[1]);
    pass(CONTEXT_RESTORE_MS);
    expect(FakeMap.made).toHaveLength(2);
    expect(drawn()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(
      /graphics context was lost\. The data of the map is in the table\./,
    );
    expect(
      screen.getByRole("table", { name: "Data of map Answer" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));

    Observer.made.at(-2)?.see(true);
    Observer.made.at(-1)?.see(true);
    expect(screen.queryByRole("table")).toBeNull();
    expect(drawn()).toHaveLength(1);
  });

  it("no longer listens to the canvas of a map that is gone", () => {
    const view = mount();
    const [map] = FakeMap.made;
    lose(map);
    view.unmount();
    pass(CONTEXT_RESTORE_MS * 2);
    lose(map);
    pass(CONTEXT_RESTORE_MS * 2);
    expect(FakeMap.made).toHaveLength(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });
});

describe("a map the library cannot make", () => {
  it("shows its data and why, and tries again when the reader asks", () => {
    FakeMap.fails = true;
    render(<MapView spec={SPEC} name="Answer" />);
    see(0, "view");
    expect(screen.getByRole("status").textContent).toMatch(
      /cannot draw the map: WebGL/,
    );
    expect(
      screen.getByRole("table", { name: "Data of map Answer" }),
    ).toBeInTheDocument();
    FakeMap.fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload map" }));
    Observer.made.at(-2)?.see(true);
    Observer.made.at(-1)?.see(true);
    expect(screen.queryByRole("table")).toBeNull();
    expect(drawn()).toHaveLength(1);
  });
});
