import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askToDraw,
  INTENT_MS,
  MapBudget,
  type SlotFacts,
  schedule,
  useAskedToDraw,
  useMapSlot,
} from "~/components/Geo/mapBudget";

const facts = (id: string, more: Partial<SlotFacts> = {}): SlotFacts => ({
  id,
  inView: true,
  near: true,
  pinned: false,
  intent: 0,
  seen: 1,
  holds: false,
  still: false,
  ...more,
});
const modes = (slots: SlotFacts[], budget: number) =>
  Object.fromEntries(schedule(slots, budget)) as Record<string, string>;

describe("what each map does next", () => {
  it("draws every map near the screen while there is room, those in view first", () => {
    const slots = [
      facts("near", { inView: false, seen: 1 }),
      facts("a", { seen: 2 }),
      facts("b", { seen: 3 }),
    ];
    expect(modes(slots, 3)).toEqual({ near: "live", a: "live", b: "live" });

    expect(modes(slots, 2)).toEqual({ near: "none", a: "live", b: "passing" });
  });

  it("draws no map before it was near what is on screen", () => {
    expect(modes([facts("far", { inView: false, near: false, seen: 0 })], 4)).toEqual({
      far: "none",
    });
  });

  it("keeps one place for taking stills while a map in view has none, and takes one at a time", () => {
    const slots = Array.from({ length: 6 }, (_, at) =>
      facts(`m${at}`, { seen: at + 1 }),
    );

    expect(modes(slots, 3)).toEqual({
      m0: "live",
      m1: "live",
      m2: "passing",
      m3: "none",
      m4: "none",
      m5: "none",
    });
  });

  it("gives no context while as many are held as the budget, also to a map that should have one", () => {
    const slots = [
      facts("a", { holds: true, seen: 1 }),
      facts("b", { holds: true, seen: 2 }),
      facts("wanted", { intent: 9, still: true, seen: 3 }),
    ];

    expect(modes(slots, 2)).toEqual({ a: "live", b: "passing", wanted: "none" });

    slots[1] = facts("b", { holds: false, still: true, seen: 2 });
    expect(modes(slots, 2)).toEqual({ a: "live", b: "none", wanted: "live" });
  });

  it("lets the map go that the reader used longest ago", () => {
    const slots = [
      facts("old", { holds: true, intent: 1, still: true }),
      facts("recent", { holds: true, intent: 5, still: true }),
      facts("now", { intent: 9, still: true }),
    ];
    expect(modes(slots, 2)).toEqual({ old: "passing", recent: "live", now: "none" });
  });

  it("swaps no map without a reason: a drawn map stays drawn before one that is not", () => {
    const slots = [
      facts("a", { still: true, seen: 1 }),
      facts("b", { holds: true, still: true, seen: 2 }),
    ];
    expect(modes(slots, 1)).toEqual({ a: "none", b: "live" });
  });

  it("draws a pinned map before every other one", () => {
    const slots = [
      facts("a", { holds: true, intent: 9, still: true }),
      facts("large", { pinned: true, inView: false, near: false, seen: 0 }),
    ];
    expect(modes(slots, 1)).toEqual({ a: "passing", large: "none" });
    slots[0] = facts("a", { intent: 9, still: true });
    expect(modes(slots, 1)).toEqual({ a: "none", large: "live" });
  });

  it("keeps a map that left the screen drawn while there is room, and lets it go when there is none", () => {
    const left = facts("left", { inView: false, near: false, holds: true, seen: 1 });
    expect(modes([left, facts("a", { seen: 2 })], 2)).toEqual({
      left: "live",
      a: "live",
    });
    expect(
      modes(
        [
          left,
          facts("a", { seen: 2, still: true }),
          facts("b", { seen: 3, still: true }),
        ],
        2,
      ),
    ).toEqual({ left: "passing", a: "live", b: "none" });
  });
});

describe("the maps of a page", () => {
  const pass = (budget: MapBudget, ids: readonly string[]) => {
    const passing = ids.filter((id) => budget.mode(id) === "passing");
    for (const id of passing) {
      budget.set(id, { still: true });
      budget.released(id);
    }
    return passing.length;
  };

  it("never holds more contexts than the budget on a page of thirty maps in view, and shows every one", () => {
    const budget = new MapBudget(8);
    const ids = Array.from({ length: 30 }, (_, at) => `m${at}`);
    let most = 0;
    const stilled = new Set<string>();
    budget.subscribe(() => {
      most = Math.max(most, budget.held());
    });
    for (const id of ids) {
      budget.add(id);
      budget.set(id, { inView: true, near: true });
    }
    for (let round = 0; round < 100; round++) {
      const passing = ids.filter((id) => budget.mode(id) === "passing");
      expect(passing.length).toBeLessThanOrEqual(1);
      for (const id of passing) stilled.add(id);
      if (!pass(budget, ids)) break;
    }
    expect(most).toBe(8);
    const live = ids.filter((id) => budget.mode(id) === "live");
    expect(live).toHaveLength(8);

    for (const id of ids) expect(live.includes(id) || stilled.has(id)).toBe(true);
    expect(ids.filter((id) => budget.mode(id) === "passing")).toEqual([]);
  });

  it("draws the still the reader points at, after the map used longest ago gave its context back", () => {
    const budget = new MapBudget(2);
    const ids = ["a", "b", "c"];
    for (const id of ids) {
      budget.add(id);
      budget.set(id, { inView: true, near: true });
    }
    while (pass(budget, ids));
    expect(ids.map((id) => budget.mode(id))).toEqual(["live", "live", "none"]);
    budget.intent("b");
    budget.intent("c");

    expect(ids.map((id) => budget.mode(id))).toEqual(["passing", "live", "none"]);
    expect(budget.held()).toBe(2);
    pass(budget, ids);
    expect(ids.map((id) => budget.mode(id))).toEqual(["none", "live", "live"]);
  });

  it("gives the place of a map that goes to the next one", () => {
    const budget = new MapBudget(1);
    for (const id of ["a", "b"]) {
      budget.add(id);
      budget.set(id, { inView: true, near: true, still: true });
    }
    expect(budget.mode("a")).toBe("live");
    expect(budget.mode("b")).toBe("none");
    budget.remove("a");
    expect(budget.mode("b")).toBe("live");
    expect(budget.held()).toBe(1);
  });

  it("tells who listens when something changed, and not for a fact that is the same", () => {
    const budget = new MapBudget(1);
    const heard = vi.fn();
    const leave = budget.subscribe(heard);
    budget.add("a");
    budget.set("a", { inView: true, near: true });
    expect(heard).toHaveBeenCalledTimes(1);
    budget.set("a", { inView: true });
    expect(heard).toHaveBeenCalledTimes(1);
    leave();
    budget.intent("a");
    expect(heard).toHaveBeenCalledTimes(1);

    budget.set("ghost", { inView: true });
    budget.intent("ghost");
    budget.released("ghost");
    expect(budget.mode("ghost")).toBe("none");
  });
});

class Observer {
  static made: Observer[] = [];
  disconnected = false;
  readonly watched: Element[] = [];
  constructor(
    private readonly tell: (entries: { isIntersecting: boolean }[]) => void,
    readonly options?: { rootMargin?: string },
  ) {
    Observer.made.push(this);
  }
  observe(element: Element) {
    this.watched.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  see(isIntersecting: boolean) {
    act(() => this.tell([{ isIntersecting }]));
  }
}

describe("the place of a map in the budget", () => {
  beforeEach(() => {
    Observer.made = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const mounted = (
    budget: MapBudget,
    more: { wanted?: boolean; pinned?: boolean } = {},
  ) => {
    const hook = renderHook(
      (props: { wanted: boolean; pinned: boolean }) =>
        useMapSlot(props.wanted, props.pinned, budget),
      { initialProps: { wanted: more.wanted ?? true, pinned: more.pinned ?? false } },
    );
    const box = document.createElement("div");
    act(() => hook.result.current.ref(box));
    const mine = Observer.made.slice(-2);
    return {
      hook,
      box,
      mode: () => hook.result.current.mode,

      see: (where: "view" | "near" | "far") => {
        mine[0]?.see(where !== "far");
        mine[1]?.see(where === "view");
      },
    };
  };

  it("draws at once where the browser cannot say what is in view", () => {
    const { mode, hook } = mounted(new MapBudget(2));
    expect(mode()).toBe("live");
    expect(hook.result.current.near).toBe(true);
  });

  it("waits for its box to come near what is on screen", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const { mode, box, see, hook } = mounted(new MapBudget(2));
    expect(mode()).toBe("none");
    expect(Observer.made.map((observer) => observer.options?.rootMargin)).toEqual([
      "200px",
      "0px",
    ]);
    expect(Observer.made.every((observer) => observer.watched[0] === box)).toBe(true);
    see("near");
    expect(mode()).toBe("live");
    expect(hook.result.current.near).toBe(true);
  });

  it("draws a map far from the screen while something outside it asks for it, and lets it go after", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const budget = new MapBudget(2);
    const hook = renderHook(() => {
      const asked = useAskedToDraw("map-far");
      return { asked, slot: useMapSlot(true, asked, budget) };
    });
    const box = document.createElement("div");
    act(() => hook.result.current.slot.ref(box));
    const [near, inView] = Observer.made.slice(-2);
    near.see(false);
    inView.see(false);
    expect(hook.result.current.slot.mode).toBe("none");
    let release = () => {};
    act(() => {
      release = askToDraw("map-far");
    });
    expect(hook.result.current.asked).toBe(true);
    expect(hook.result.current.slot.mode).toBe("live");

    let other = () => {};
    act(() => {
      other = askToDraw("map-far");
    });
    act(() => {
      release();
      release();
    });
    expect(hook.result.current.asked).toBe(true);
    act(() => other());
    expect(hook.result.current.asked).toBe(false);
  });

  it("takes the pointer that stays on its box as intent, not one that passes over it", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    vi.useFakeTimers();
    const budget = new MapBudget(1);
    const first = mounted(budget);
    const second = mounted(budget);
    for (const map of [first, second]) {
      map.see("view");
      act(() => map.hook.result.current.setStill(true));
    }
    expect([first.mode(), second.mode()]).toEqual(["live", "none"]);

    act(() => void second.box.dispatchEvent(new Event("pointerenter")));
    act(() => void vi.advanceTimersByTime(INTENT_MS - 1));
    act(() => void second.box.dispatchEvent(new Event("pointerleave")));
    act(() => void vi.advanceTimersByTime(INTENT_MS * 2));
    expect([first.mode(), second.mode()]).toEqual(["live", "none"]);

    act(() => void second.box.dispatchEvent(new Event("pointerenter")));
    act(() => void vi.advanceTimersByTime(INTENT_MS));
    expect([first.mode(), second.mode()]).toEqual(["passing", "none"]);
    act(() => first.hook.result.current.released());
    expect([first.mode(), second.mode()]).toEqual(["none", "live"]);
  });

  it.each([
    "focusin",
    "touchstart",
    "pointerdown",
  ])("takes %s on its box as intent at once", (kind) => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const budget = new MapBudget(1);
    const first = mounted(budget);
    const second = mounted(budget);
    for (const map of [first, second]) {
      map.see("view");
      act(() => map.hook.result.current.setStill(true));
    }
    act(() => void second.box.dispatchEvent(new Event(kind, { bubbles: true })));
    expect(first.mode()).toBe("passing");
  });

  it("keeps a pinned map drawn: the one opened large, and one that plays", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const budget = new MapBudget(1);
    const first = mounted(budget);
    first.see("view");
    act(() => first.hook.result.current.setStill(true));
    const large = mounted(budget, { pinned: true });
    expect(first.mode()).toBe("passing");
    act(() => first.hook.result.current.released());
    expect(large.mode()).toBe("live");

    large.hook.rerender({ wanted: true, pinned: false });
    large.see("view");
    act(() => large.hook.result.current.setStill(true));
    act(() => first.hook.result.current.setPinned(true));
    expect(large.mode()).toBe("passing");
    act(() => first.hook.result.current.setPinned(false));
    expect(large.mode()).toBe("live");
  });

  it("gives its place back when it goes, and takes none when it is not drawn", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const budget = new MapBudget(1);
    const first = mounted(budget);
    const second = mounted(budget);
    for (const map of [first, second]) {
      map.see("view");
      act(() => map.hook.result.current.setStill(true));
    }
    expect(second.mode()).toBe("none");
    first.hook.unmount();
    expect(Observer.made.slice(0, 2).every((observer) => observer.disconnected)).toBe(
      true,
    );
    expect(second.mode()).toBe("live");

    second.hook.rerender({ wanted: false, pinned: false });
    expect(second.mode()).toBe("none");
    expect(budget.held()).toBe(0);
    const made = Observer.made.length;
    mounted(budget, { wanted: false });
    expect(Observer.made).toHaveLength(made);
  });
});
