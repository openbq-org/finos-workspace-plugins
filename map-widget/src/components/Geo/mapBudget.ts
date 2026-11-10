import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export const LIVE_MAPS = 8;

const NEAR = "200px";

export const INTENT_MS = 150;

export type SlotMode = "live" | "passing" | "none";

export interface SlotFacts {
  id: unknown;

  inView: boolean;

  near: boolean;

  pinned: boolean;

  intent: number;

  seen: number;

  holds: boolean;

  still: boolean;
}

const flag = (value: boolean) => (value ? 1 : 0);

const byRank = (a: SlotFacts, b: SlotFacts) =>
  flag(b.pinned) - flag(a.pinned) ||
  flag(b.inView) - flag(a.inView) ||
  flag(b.near) - flag(a.near) ||
  b.intent - a.intent ||

  flag(b.holds) - flag(a.holds) ||

  (a.near ? a.seen - b.seen : b.seen - a.seen);

export function schedule(
  slots: readonly SlotFacts[],
  budget: number,
): Map<unknown, SlotMode> {
  const ranked = slots
    .filter((slot) => slot.seen > 0 || slot.pinned || slot.holds)
    .sort(byRank);

  const waiting = (count: number) => {
    const drawn = new Set(ranked.slice(0, count).map((slot) => slot.id));
    return ranked
      .filter((slot) => slot.near && !slot.still && !slot.holds && !drawn.has(slot.id))
      .sort((a, b) => flag(b.inView) - flag(a.inView) || a.seen - b.seen);
  };
  const reserve = waiting(budget).length > 0;
  const places = reserve ? Math.max(0, budget - 1) : budget;
  const drawn = ranked.slice(0, places);
  const next = reserve ? waiting(places)[0] : undefined;

  const modes = new Map<unknown, SlotMode>();
  const keep = new Set(drawn.map((slot) => slot.id));
  let held = 0;
  for (const slot of slots) {
    if (slot.holds) held += 1;
    modes.set(slot.id, slot.holds ? (keep.has(slot.id) ? "live" : "passing") : "none");
  }
  for (const slot of drawn) {
    if (slot.holds) continue;
    if (held >= budget) return modes;
    modes.set(slot.id, "live");
    held += 1;
  }
  if (next && held < budget) modes.set(next.id, "passing");
  return modes;
}

export class MapBudget {
  private readonly slots = new Map<unknown, SlotFacts>();
  private readonly listeners = new Set<() => void>();
  private modes = new Map<unknown, SlotMode>();
  private clock = 0;

  constructor(private readonly limit = LIVE_MAPS) {}

  add(id: unknown): void {
    if (this.slots.has(id)) return;
    this.slots.set(id, {
      id,
      inView: false,
      near: false,
      pinned: false,
      intent: 0,
      seen: 0,
      holds: false,
      still: false,
    });
  }

  remove(id: unknown): void {
    if (this.slots.delete(id)) this.settle();
  }

  set(
    id: unknown,
    facts: Partial<Pick<SlotFacts, "inView" | "near" | "pinned" | "still">>,
  ): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    const keys = Object.keys(facts) as (keyof typeof facts)[];
    if (keys.every((key) => slot[key] === facts[key])) return;
    const near = slot.near;
    Object.assign(slot, facts);
    if (slot.near !== near) {
      this.clock += 1;
      slot.seen = this.clock;
    }
    this.settle();
  }

  intent(id: unknown): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    this.clock += 1;
    slot.intent = this.clock;
    this.settle();
  }

  released(id: unknown): void {
    const slot = this.slots.get(id);
    if (!slot?.holds) return;
    slot.holds = false;
    this.settle();
  }

  mode(id: unknown): SlotMode {
    return this.modes.get(id) ?? "none";
  }

  held(): number {
    let count = 0;
    for (const slot of this.slots.values()) if (slot.holds) count += 1;
    return count;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private settle(): void {
    this.modes = schedule([...this.slots.values()], this.limit);

    for (const [id, mode] of this.modes) {
      const slot = this.slots.get(id);
      if (slot && mode !== "none") slot.holds = true;
    }
    for (const listener of [...this.listeners]) listener();
  }
}

export const mapBudget = new MapBudget();

const asked = new Map<string, number>();
const askListeners = new Set<() => void>();
const tellAsks = () => {
  for (const listener of [...askListeners]) listener();
};

export function askToDraw(widgetId: string): () => void {
  asked.set(widgetId, (asked.get(widgetId) ?? 0) + 1);
  tellAsks();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (asked.get(widgetId) ?? 1) - 1;
    if (left > 0) asked.set(widgetId, left);
    else asked.delete(widgetId);
    tellAsks();
  };
}

const subscribeAsks = (listener: () => void) => {
  askListeners.add(listener);
  return () => {
    askListeners.delete(listener);
  };
};

export function useAskedToDraw(widgetId: string | undefined): boolean {
  return useSyncExternalStore(subscribeAsks, () =>
    widgetId === undefined ? false : asked.has(widgetId),
  );
}

export interface MapSlot {
  ref: (element: HTMLElement | null) => void;
  mode: SlotMode;

  near: boolean;

  setStill: (current: boolean) => void;

  setPinned: (pinned: boolean) => void;

  released: () => void;
}

export function useMapSlot(
  wanted: boolean,
  pinned = false,
  budget: MapBudget = mapBudget,
): MapSlot {
  const id = useRef({}).current;
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const busy = useRef(false);
  const pin = useCallback(
    () => budget.set(id, { pinned: pinned || busy.current }),
    [budget, id, pinned],
  );
  useEffect(() => {
    if (!wanted || !box) return;
    budget.add(id);
    budget.set(id, { pinned: pinned || busy.current });
    let hover: ReturnType<typeof setTimeout> | undefined;
    const now = () => budget.intent(id);
    const enter = () => {
      clearTimeout(hover);
      hover = setTimeout(now, INTENT_MS);
    };
    const leave = () => clearTimeout(hover);
    box.addEventListener("pointerenter", enter);
    box.addEventListener("pointerleave", leave);

    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Element && event.target.closest("[data-map-data]")))
        now();
    };
    box.addEventListener("pointerdown", now);
    box.addEventListener("focusin", focus);
    box.addEventListener("touchstart", now, { passive: true });
    const observers: IntersectionObserver[] = [];
    if (typeof IntersectionObserver === "undefined") {
      budget.set(id, { inView: true, near: true });
      setNear(true);
    } else {
      const watch = (margin: string, tell: (on: boolean) => void) => {
        const observer = new IntersectionObserver(
          (entries) => {
            const last = entries.at(-1);
            if (last) tell(last.isIntersecting);
          },
          { rootMargin: margin },
        );
        observer.observe(box);
        observers.push(observer);
      };
      watch(NEAR, (on) => {
        budget.set(id, { near: on });
        setNear(on);
      });
      watch("0px", (on) => budget.set(id, { inView: on }));
    }
    return () => {
      clearTimeout(hover);
      box.removeEventListener("pointerenter", enter);
      box.removeEventListener("pointerleave", leave);
      box.removeEventListener("pointerdown", now);
      box.removeEventListener("focusin", focus);
      box.removeEventListener("touchstart", now);
      for (const observer of observers) observer.disconnect();
      budget.remove(id);
      setNear(false);
    };
  }, [wanted, box, budget, id]);
  useEffect(pin, [pin]);
  const mode = useSyncExternalStore(budget.subscribe, () => budget.mode(id));
  const setStill = useCallback(
    (current: boolean) => budget.set(id, { still: current }),
    [budget, id],
  );
  const setPinned = useCallback(
    (on: boolean) => {
      busy.current = on;
      pin();
    },
    [pin],
  );
  const released = useCallback(() => budget.released(id), [budget, id]);
  return { ref: setBox, mode, near, setStill, setPinned, released };
}
