import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TimeSlider, { FRAME_MS } from "~/components/Geo/TimeSlider";

const FRAMES = ["2019", "2020", "2021", "2022"];

function Mounted({
  start = FRAMES[0],
  frames = FRAMES,
  seen,
  compact,
}: {
  start?: string;
  frames?: string[];
  seen: (frame: string) => void;
  compact?: boolean;
}) {
  const [frame, setFrame] = useState(start);
  return (
    <TimeSlider
      frames={frames}
      frame={frame}
      compact={compact}
      onFrame={(next) => {
        seen(next);
        setFrame(next);
      }}
    />
  );
}
const mount = (props: Partial<Parameters<typeof Mounted>[0]> = {}) => {
  const seen = vi.fn();
  return { seen, ...render(<Mounted seen={seen} {...props} />) };
};
const range = () => screen.getByRole<HTMLInputElement>("slider", { name: "Time" });
const tick = (steps = 1) => act(() => vi.advanceTimersByTime(FRAME_MS * steps));

const motion = (reduce: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

beforeEach(() => motion(false));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

describe("the steps of time of a map", () => {
  it("is a slider over the steps that says the step it is on", () => {
    mount({ start: "2021" });
    expect(range()).toMatchObject({ type: "range", min: "0", max: "3", value: "2" });
    expect(range().getAttribute("aria-valuetext")).toBe("2021");
    expect(screen.getByText("2021").getAttribute("title")).toBe("2021");
    expect(screen.getByRole("group", { name: "Steps of time" })).toBeInTheDocument();
  });

  it("goes to the step the reader slides to", () => {
    const { seen } = mount();
    fireEvent.change(range(), { target: { value: "3" } });
    expect(seen).toHaveBeenLastCalledWith("2022");
    expect(screen.getByText("2022")).toBeInTheDocument();
  });

  it("steps back and forward with the arrows, and stays inside the steps", async () => {
    const { seen } = mount({ start: "2020" });
    range().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(seen).toHaveBeenLastCalledWith("2021");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(seen).toHaveBeenLastCalledWith("2019");
    seen.mockClear();
    await userEvent.keyboard("{ArrowLeft}");
    expect(seen).not.toHaveBeenCalled();
    await userEvent.keyboard("{End}");
    expect(seen).toHaveBeenLastCalledWith("2022");
    seen.mockClear();
    await userEvent.keyboard("{ArrowRight}");
    expect(seen).not.toHaveBeenCalled();
    await userEvent.keyboard("{Home}");
    expect(seen).toHaveBeenLastCalledWith("2019");
  });

  it("starts at the first step for a step the map does not have", () => {
    mount({ start: "1999" });
    expect(range().value).toBe("0");
    expect(screen.getByText("2019")).toBeInTheDocument();
  });

  it("is not shown for a map of one step or none", () => {
    const { container, unmount } = mount({ frames: ["2019"] });
    expect(container.firstElementChild).toBeNull();
    unmount();
    expect(mount({ frames: [] }).container.firstElementChild).toBeNull();
  });

  it("says whether it is on a small map or a large one, for the bar that lays it out", () => {
    const { unmount } = mount({ compact: true });
    const small = screen.getByRole("group", { name: "Steps of time" });
    expect(small.getAttribute("data-map-time")).toBe("compact");
    unmount();
    mount();
    const large = screen.getByRole("group", { name: "Steps of time" });
    expect(large.getAttribute("data-map-time")).toBe("wide");
  });
});

describe("playing the steps", () => {
  beforeEach(() => vi.useFakeTimers());
  const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

  it("shows the next step after the time of a step, not a millisecond before, and stops at the last", () => {
    const { seen } = mount();
    press("Play");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(FRAME_MS - 1));
    expect(seen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(seen).toHaveBeenLastCalledWith("2020");
    tick();
    expect(seen).toHaveBeenLastCalledWith("2021");
    tick();
    expect(seen).toHaveBeenLastCalledWith("2022");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    tick(5);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("says when it plays and when it stops: at a pause, at the last step and when it goes", () => {
    const onPlaying = vi.fn();
    const steps = ["2019", "2020"];
    function Playing() {
      const [frame, setFrame] = useState(steps[0]);
      return (
        <TimeSlider
          frames={steps}
          frame={frame}
          onFrame={setFrame}
          onPlaying={onPlaying}
        />
      );
    }
    const view = render(<Playing />);
    expect(onPlaying).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlaying.mock.calls).toEqual([[true]]);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPlaying.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    tick();
    expect(onPlaying.mock.calls).toEqual([[true], [false], [true], [false]]);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    view.unmount();
    expect(onPlaying.mock.calls.at(-1)).toEqual([false]);
  });

  it("pauses where it is", () => {
    const { seen } = mount();
    press("Play");
    tick();
    press("Pause");
    tick(5);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(range().value).toBe("1");
  });

  it("starts again from the first step when play is pressed at the end", () => {
    const { seen } = mount({ start: "2022" });
    press("Play");
    expect(seen).toHaveBeenLastCalledWith("2019");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    tick();
    expect(seen).toHaveBeenLastCalledWith("2020");
  });

  it("stops when the reader slides to the last step", () => {
    const { seen } = mount();
    press("Play");
    fireEvent.change(range(), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    tick(3);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops when the tab is hidden", () => {
    const { seen } = mount();
    press("Play");
    tick();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    tick(5);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops when the map is gone", () => {
    const { seen, unmount } = mount();
    press("Play");
    unmount();
    tick(5);
    expect(seen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not play for a reader who asked for less motion: it steps instead", () => {
    motion(true);
    const { seen } = mount({ start: "2020" });
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    tick(5);
    expect(seen).not.toHaveBeenCalled();
    press("Next step");
    expect(seen).toHaveBeenLastCalledWith("2021");
    press("Next step");
    expect(seen).toHaveBeenLastCalledWith("2022");
    expect(screen.getByRole("button", { name: "Next step" })).toHaveProperty(
      "disabled",
      true,
    );
    press("Previous step");
    expect(seen).toHaveBeenLastCalledWith("2021");
    tick(5);
    expect(seen).toHaveBeenCalledTimes(3);
    expect(range().value).toBe("2");
  });

  it("works where the browser cannot say what motion the reader wants", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { seen } = mount();
    press("Play");
    tick();
    expect(seen).toHaveBeenLastCalledWith("2020");
  });
});
