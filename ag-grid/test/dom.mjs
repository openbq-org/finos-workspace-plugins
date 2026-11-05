import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: "https://localhost/", pretendToBeVisual: true });

for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLCanvasElement",
  "Element",
  "SVGElement",
  "DocumentFragment",
  "Node",
  "MutationObserver",
  "DOMParser",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "CustomEvent",
  "Event",
]) {
  if (dom.window[name] !== undefined) Object.defineProperty(globalThis, name, { value: name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis, "location", { value: dom.window.location, configurable: true, writable: true });
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;

const noop = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === "width" || key === "actualBoundingBoxAscent" || key === "actualBoundingBoxDescent" ? 10 : noop),
  apply: () => noop,
  construct: () => noop,
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => noop;
dom.window.HTMLCanvasElement.prototype.toDataURL = () => "";
globalThis.Path2D = dom.window.Path2D = class {
  constructor() {
    return noop;
  }
};
globalThis.OffscreenCanvas = dom.window.OffscreenCanvas = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return noop;
  }
  transferToImageBitmap() {
    return noop;
  }
};
globalThis.ResizeObserver = dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

export function makeModel(values) {
  const listeners = {};
  const model = {
    values: { theme: { mode: "light", tokens: {} }, adminSettings: {}, config: {}, state: null, params: {}, ...values },
    writes: [],
    get(key) {
      return structuredClone(this.values[key]);
    },
    set(key, value) {
      this.values[key] = structuredClone(value);
      this.writes.push([key, structuredClone(value)]);
      this.emit(`change:${key}`);
    },
    save_changes() {},
    on(name, cb) {
      (listeners[name] = listeners[name] || []).push(cb);
    },
    off(name, cb) {
      listeners[name] = (listeners[name] || []).filter((c) => c !== cb);
    },
    emit(name, ...args) {
      (listeners[name] || []).slice().forEach((cb) => cb(...args));
    },
    push(key, value) {
      this.values[key] = structuredClone(value);
      this.emit(`change:${key}`);
    },
    listenerCount(name) {
      return (listeners[name] || []).length;
    },
  };
  return model;
}

export const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

export function mount() {
  const el = document.createElement("div");
  el.style.width = "800px";
  el.style.height = "600px";
  document.body.appendChild(el);
  return { el, abort: new AbortController() };
}

export async function liveApi(root = document) {
  const { getGridApi } = await import("ag-grid-enterprise");
  for (const wrapper of [...root.querySelectorAll(".ag-root-wrapper")].reverse()) {
    for (let node = wrapper.parentElement; node; node = node.parentElement) {
      const api = getGridApi(node);
      if (api && !api.isDestroyed()) return api;
    }
  }
  throw new Error("no live grid");
}

export const notifications = [];
export const experimental = {
  async invoke(name, message) {
    notifications.push([name, message]);
    return [{}, []];
  },
};
