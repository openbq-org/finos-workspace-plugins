import "@testing-library/jest-dom/vitest";
import "vitest-canvas-mock";
import { afterEach, vi } from "vitest";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver;

global.URL.createObjectURL = vi.fn();

if (typeof Element.prototype.scrollIntoView !== "function")
  Element.prototype.scrollIntoView = vi.fn();

window.scrollTo = vi.fn();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(async () => {
  await vi.dynamicImportSettled();
});
