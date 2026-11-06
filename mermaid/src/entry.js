import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { parsePie, pieSvg } from "./pie.js";
import { isSafeLink, makeSanitizer } from "./sanitize.js";
import { MAX_SOURCE, RENDER_TIMEOUT_MS, SERIES, TOKENS, boxOf, configFor, exportSize, fit, modeOf, sourceOf, zoomAt } from "./diagram.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_MESSAGE = 2000;
let sanitizer;
const sanitize = (markup) => (sanitizer ??= makeSanitizer(DOMPurify))(markup);
const serialize = (node) => new XMLSerializer().serializeToString(node);

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the diagram took longer than ${ms / 1000} seconds to draw`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

let drawn = null;
let failure = null;
let counter = 0;

function standalone(drawing) {
  if (drawing.pie) return serialize(sanitize(drawing.pie()));
  const clone = drawing.node.cloneNode(true);
  clone.removeAttribute("style");
  clone.setAttribute("width", drawing.box.w);
  clone.setAttribute("height", drawing.box.h);
  if (drawing.background) {
    const fill = document.createElementNS(SVG_NS, "rect");
    fill.setAttribute("x", drawing.box.x);
    fill.setAttribute("y", drawing.box.y);
    fill.setAttribute("width", drawing.box.w);
    fill.setAttribute("height", drawing.box.h);
    fill.setAttribute("fill", drawing.background);
    clone.insertBefore(fill, clone.firstChild);
  }
  return serialize(sanitize(serialize(clone)));
}

async function png(svg, box) {
  const { width, height } = exportSize(box);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("the diagram could not be turned into an image"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default {
  initialize({ model }) {
    const source = () => sourceOf(model.get("data"));
    return {
      async exportOptions() {
        const options = [];
        if (drawn) {
          options.push({ id: "svg", label: "Diagram (SVG)", extension: "svg", mime: "image/svg+xml" });
          options.push({ id: "png", label: "Diagram (PNG)", extension: "png", mime: "image/png" });
        }
        if (source()) options.push({ id: "source", label: "Source (Mermaid)", extension: "mmd", mime: "text/plain" });
        return options;
      },
      async exportData(id) {
        if (id === "source") return source();
        if (!drawn) return null;
        const svg = standalone(drawn);
        if (id === "svg") return svg;
        return id === "png" ? png(svg, drawn.box) : null;
      },
      async copilotContext() {
        const text = source();
        if (!text) return null;
        return { type: drawn?.type ?? null, source: text, ...(failure ? { error: failure } : {}) };
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    const stage = document.createElement("div");
    stage.className = "mermaid-stage";
    const canvas = document.createElement("div");
    canvas.className = "mermaid-canvas";
    stage.append(canvas);
    const message = document.createElement("pre");
    message.className = "mermaid-message";
    el.classList.add("mermaid-root");
    el.replaceChildren(stage, message);

    const read = (name) => getComputedStyle(el).getPropertyValue(name);
    const applyTheme = () => {
      const theme = model.get("theme");
      const tokens = theme?.tokens ?? {};
      el.dataset.mode = modeOf(theme);
      for (const token of TOKENS) {
        if (tokens[token]) el.style.setProperty(`--ws-${token}`, tokens[token]);
        else el.style.removeProperty(`--ws-${token}`);
      }
      return theme;
    };

    let pending = false;
    let latest = 0;
    let box = null;
    let view = null;
    let fitted = true;

    const place = () => {
      canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    };
    const refit = () => {
      if (!box) return;
      view = fit(box, { w: el.clientWidth, h: el.clientHeight });
      fitted = true;
      place();
    };
    const clear = (text) => {
      canvas.replaceChildren();
      box = null;
      drawn = null;
      message.textContent = text;
    };

    const pieColors = () => ({
      series: Array.from({ length: SERIES }, (_, i) => read(`--mm-series-${i + 1}`).trim()),
      text: read("--mm-pie-legend-text-color").trim(),
      muted: read("--mm-line").trim(),
      background: read("--mm-background").trim(),
      gap: read("--mm-pie-stroke-color").trim(),
      font: read("--mm-font-family").trim(),
    });

    const drawPie = (pie, theme) => {
      const colors = pieColors();
      const locale = theme?.locale ?? "en-US";
      const width = el.clientWidth;
      const height = el.clientHeight;
      canvas.replaceChildren(sanitize(pieSvg(pie, { width, height, colors: { ...colors, background: "" }, locale })));
      canvas.style.transform = "none";
      stage.classList.add("is-static");
      box = null;
      view = null;
      message.textContent = "";
      failure = null;
      drawn = {
        node: canvas.firstElementChild,
        box: { x: 0, y: 0, w: 900, h: 540 },
        type: "pie",
        pie: () => pieSvg(pie, { width: 900, height: 540, colors, locale, interactive: false }),
      };
    };

    const highlight = (index) => {
      const svg = canvas.querySelector("svg.pie");
      if (!svg) return;
      const slices = JSON.parse(svg.dataset.slices ?? "[]");
      const value = svg.querySelector(".pie-centre-value");
      const label = svg.querySelector(".pie-centre-label");
      svg.classList.toggle("has-active", index !== null);
      for (const node of svg.querySelectorAll("[data-i]")) node.classList.toggle("active", node.dataset.i === String(index));
      value.textContent = index === null ? value.dataset.total : slices[index].value;
      label.textContent = index === null ? label.dataset.total : slices[index].label;
    };

    const draw = async () => {
      pending = !el.clientWidth || !el.clientHeight;
      if (pending) return;
      const turn = ++latest;
      const source = sourceOf(model.get("data"));
      if (!source) {
        failure = null;
        clear("The endpoint did not return a Mermaid diagram.");
        return;
      }
      const fail = (error) => {
        failure = String(error?.message ?? error).slice(0, MAX_MESSAGE);
        clear(`The diagram could not be drawn.\n\n${failure}`);
      };
      if (source.length > MAX_SOURCE) {
        fail(new Error(`the diagram text has ${source.length} characters; the limit is ${MAX_SOURCE}`));
        return;
      }
      const theme = applyTheme();
      try {
        const pie = parsePie(source);
        if (pie) {
          drawPie(pie, theme);
          return;
        }
        stage.classList.remove("is-static");
        mermaid.initialize(configFor(theme, read));
        const { svg, diagramType } = await withDeadline(mermaid.render(`mermaid-${++counter}`, source), RENDER_TIMEOUT_MS);
        if (turn !== latest || signal.aborted) return;
        canvas.replaceChildren(sanitize(svg));
        const node = canvas.querySelector("svg");
        const next = boxOf(node.getAttribute("viewBox"));
        if (!next) throw new Error("the diagram has no size");
        node.setAttribute("width", next.w);
        node.setAttribute("height", next.h);
        node.style.maxWidth = "none";
        node.style.display = "block";
        message.textContent = "";
        failure = null;
        box = next;
        drawn = { node, box: next, type: diagramType, background: read("--mm-background").trim() };
        if (fitted || !view) refit();
        else place();
      } catch (error) {
        if (turn !== latest || signal.aborted) return;
        fail(error);
      }
    };

    model.on("change:data", draw);
    model.on("change:theme", draw);
    draw();

    const resize = new ResizeObserver(() => {
      if (pending || drawn?.pie) draw();
      else if (fitted) refit();
    });
    resize.observe(el);

    let drag = null;
    let moved = false;
    const onPointerDown = (event) => {
      if (!box || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, view };
      moved = false;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("is-dragging");
    };
    const onPointerMove = (event) => {
      if (!drag) return;
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) moved = true;
      view = { ...drag.view, x: drag.view.x + event.clientX - drag.x, y: drag.view.y + event.clientY - drag.y };
      fitted = false;
      place();
    };
    const onPointerEnd = () => {
      drag = null;
      stage.classList.remove("is-dragging");
    };
    const onWheel = (event) => {
      if (!box || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const lines = event.deltaMode === 1 ? 16 : 1;
      const delta = event.deltaY * lines;
      view = zoomAt(view, Math.exp(-delta * (Math.abs(delta) < 50 ? 0.01 : 0.002)), event.clientX - rect.left, event.clientY - rect.top);
      fitted = false;
      place();
    };
    const onClick = (event) => {
      const link = event.target.closest?.("a");
      if (!link) return;
      event.preventDefault();
      const url = link.getAttribute("href") ?? link.getAttribute("xlink:href");
      if (url && !moved && isSafeLink(url) && !url.startsWith("#")) experimental.invoke("core:ui:open-link", { url }).catch(() => {});
    };
    const onOver = (event) => {
      const target = event.target.closest?.("[data-i]");
      highlight(target ? Number(target.dataset.i) : null);
    };
    stage.addEventListener("pointerover", onOver);
    stage.addEventListener("pointerleave", () => highlight(null));
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerEnd);
    stage.addEventListener("pointercancel", onPointerEnd);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("click", onClick);
    stage.addEventListener("dblclick", refit);

    signal.addEventListener("abort", () => {
      resize.disconnect();
      model.off("change:data", draw);
      model.off("change:theme", draw);
      drawn = null;
      failure = null;
    });
  },
};
