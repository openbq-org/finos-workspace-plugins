import { csvLine, csvOf, modebarOf, pointRows, staticOf, stateOf, summary, viewFromRelayout, viewed, visibilityFromRestyle } from "./figure.js";

const PLOTLY_SOURCE = "__PLOTLY_SOURCE__";
const MATHJAX_ASSET = "assets/mathjax-tex-svg.js";
const topojsonAsset = (name) => `assets/topojson-${name}.json`;

function runScript(source, what) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    script.onerror = () => reject(new Error(`${what} could not be loaded`));
    document.head.appendChild(script);
  });
}

function startBlobWorkersClassic() {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const blobModule = options?.type === "module" && String(url).startsWith("blob:");
      super(url, blobModule ? { ...options, type: "classic" } : options);
    }
  };
}

let plotlyLoading;

function loadPlotly() {
  plotlyLoading ??= (async () => {
    startBlobWorkersClassic();
    await runScript(PLOTLY_SOURCE, "plotly.js");
    return window.Plotly;
  })();
  return plotlyLoading;
}

function figureOf(response) {
  if (!response || typeof response !== "object" || !Array.isArray(response.data)) return null;
  const layout = response.layout && typeof response.layout === "object" ? response.layout : {};
  const frames = Array.isArray(response.frames) ? response.frames : undefined;
  return { data: response.data, layout, frames };
}

const GEO_TRACES = new Set(["scattergeo", "choropleth"]);

export function topojsonNames(figure) {
  const subplots = new Set(figure.data.filter((trace) => GEO_TRACES.has(trace.type)).map((trace) => trace.geo ?? "geo"));
  return [...subplots].map((id) => {
    const geo = figure.layout[id] ?? {};
    const scope = typeof geo.scope === "string" ? geo.scope : "world";
    return `${scope.replaceAll(" ", "-")}_${Number(geo.resolution) === 50 ? 50 : 110}m`;
  });
}

export function hasLatex(value, depth = 0) {
  if (typeof value === "string") return /\$[^$]*\$/.test(value);
  if (!value || typeof value !== "object" || depth > 10) return false;
  if (Array.isArray(value)) return value.length <= 1000 && value.some((item) => hasLatex(item, depth + 1));
  if (typeof value.bdata === "string") return false;
  return Object.values(value).some((item) => hasLatex(item, depth + 1));
}

const MAP_TRACES = new Set(["scattermap", "densitymap", "choroplethmap"]);

export function mapSubplots(figure) {
  return [...new Set(figure.data.filter((trace) => MAP_TRACES.has(trace.type)).map((trace) => trace.subplot ?? "map"))];
}

function unwrapRing(ring) {
  let offset = 0;
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const jump = ring[i][0] - ring[i - 1][0];
    if (jump > 180) offset -= 360;
    else if (jump < -180) offset += 360;
    out.push(offset ? [ring[i][0] + offset, ring[i][1]] : ring[i]);
  }
  return out[0][0] === out.at(-1)[0] ? out : ring;
}

export function unwrapPolygons(collection) {
  const rings = (rs) => rs.map(unwrapRing);
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const { geometry } = feature;
      if (geometry.type === "Polygon") return { ...feature, geometry: { ...geometry, coordinates: rings(geometry.coordinates) } };
      if (geometry.type === "MultiPolygon") return { ...feature, geometry: { ...geometry, coordinates: geometry.coordinates.map(rings) } };
      return feature;
    }),
  };
}

export function featuresOf(topology, name) {
  const transform = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    if (!transform) return arc;
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]];
    });
  });
  const line = (indexes) =>
    indexes.flatMap((index, k) => {
      const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
      return k ? arc.slice(1) : arc;
    });
  const lines = (list) => list.filter((indexes) => indexes.length).map(line);
  const geometry = (shape) => {
    const coordinates =
      shape.type === "LineString"
        ? line(shape.arcs)
        : shape.type === "MultiLineString" || shape.type === "Polygon"
          ? lines(shape.arcs)
          : shape.type === "MultiPolygon"
            ? shape.arcs.map(lines).filter((polygon) => polygon.length)
            : [];
    return coordinates.length ? { type: shape.type, coordinates } : null;
  };
  const object = topology.objects[name];
  const shapes = object.type === "GeometryCollection" ? object.geometries : [object];
  return {
    type: "FeatureCollection",
    features: shapes
      .map((shape) => ({ type: "Feature", properties: {}, geometry: shape.arcs ? geometry(shape) : null }))
      .filter((feature) => feature.geometry),
  };
}

const BASE_COLORS = {
  light: { water: "#d5dde3", land: "#f3f1ec", border: "#b5b5b5", coast: "#9cadb8" },
  dark: { water: "#18212b", land: "#2a323c", border: "#505b67", coast: "#3c4a57" },
};

export function splitAtAntimeridian(line) {
  const parts = [[line[0]]];
  for (let i = 1; i < line.length; i++) {
    if (Math.abs(line[i][0] - line[i - 1][0]) > 180) parts.push([line[i]]);
    else parts.at(-1).push(line[i]);
  }
  return parts.filter((part) => part.length > 1);
}

export function outlinesOf(collection) {
  const lines = (geometry) =>
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString" || geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates.flat()
          : [];
  const coordinates = collection.features.flatMap((feature) => lines(feature.geometry)).flatMap(splitAtAntimeridian);
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates } }] };
}

export function baseStyle(world, mode) {
  const colors = BASE_COLORS[mode === "light" ? "light" : "dark"];
  const source = (name) => ({ type: "geojson", data: unwrapPolygons(featuresOf(world, name)) });
  const outline = (name) => ({ type: "geojson", data: outlinesOf(featuresOf(world, name)) });
  return {
    version: 8,
    sources: { land: source("land"), lakes: source("lakes"), countries: outline("countries"), coastlines: outline("coastlines") },
    layers: [
      { id: "water", type: "background", paint: { "background-color": colors.water } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": colors.land } },
      { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": colors.water } },
      { id: "borders", type: "line", source: "countries", paint: { "line-color": colors.border, "line-width": 0.6 } },
      { id: "coastlines", type: "line", source: "coastlines", paint: { "line-color": colors.coast, "line-width": 0.6 } },
    ],
  };
}

const WHITE_BG = { version: 8, sources: {}, layers: [{ id: "white-bg", type: "background", paint: { "background-color": "#FFFFFF" } }] };

export function withMapStyle(figure, subplots, style) {
  const layout = { ...figure.layout };
  for (const id of subplots) {
    const map = layout[id] ?? {};
    if (style) layout[id] = { ...map, style };
    else if (map.style === "white-bg") layout[id] = { ...map, style: WHITE_BG };
  }
  return { ...figure, layout };
}

async function readAsset(invoke, path) {
  const [, [bytes]] = await invoke("core:asset:read", { path }, { timeout: 60_000 });
  return bytes;
}

const baseStyles = {};

async function loadBaseStyle(invoke, mode) {
  await loadOutlines(invoke, ["world_50m"]);
  baseStyles[mode] ??= baseStyle(window.PlotlyGeoAssets.topojson.world_50m, mode);
  return baseStyles[mode];
}

async function loadOutlines(invoke, names) {
  window.PlotlyGeoAssets ??= { topojson: {} };
  const outlines = window.PlotlyGeoAssets.topojson;
  await Promise.all(
    names
      .filter((name) => !outlines[name])
      .map(async (name) => {
        outlines[name] = JSON.parse(new TextDecoder().decode(await readAsset(invoke, topojsonAsset(name))));
      }),
  );
}

let mathJaxLoading;

function loadMathJax(invoke) {
  mathJaxLoading ??= (async () => {
    window.MathJax = {
      startup: { typeset: false },
      options: { enableMenu: false, menuOptions: { settings: { enrich: false, speech: false, braille: false } } },
    };
    await runScript(await readAsset(invoke, MATHJAX_ASSET), "MathJax");
    await window.MathJax.startup.promise;
  })().catch((error) => {
    mathJaxLoading = undefined;
    throw error;
  });
  return mathJaxLoading;
}

function rowsOf(response) {
  return Array.isArray(response) &&
    response.length > 0 &&
    response.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ? response
    : null;
}

const FIGURE_COLORS = {
  light: { paper: "white", plot: "#E5ECF6", font: "#2a3f5f", grid: "white" },
  dark: { paper: "rgb(17,17,17)", plot: "rgb(17,17,17)", font: "#f2f5fa", grid: "#506784" },
};

export function followsTheme(figure) {
  const { layout } = figure;
  return !(layout.template || layout.paper_bgcolor || layout.plot_bgcolor);
}

export function geoSubplots(figure) {
  const used = figure.data.filter((trace) => GEO_TRACES.has(trace.type)).map((trace) => trace.geo ?? "geo");
  const authored = Object.keys(figure.layout).filter((key) => /^geo\d*$/.test(key));
  return [...new Set([...used, ...authored])];
}

const SUBPLOT_KINDS = {
  polar: { traces: ["scatterpolar", "scatterpolargl", "barpolar"], axes: ["radialaxis", "angularaxis"] },
  ternary: { traces: ["scatterternary"], axes: ["aaxis", "baxis", "caxis"] },
  smith: { traces: ["scattersmith"], axes: ["realaxis", "imaginaryaxis"] },
};

export function themedSubplots(figure, colors) {
  const out = {};
  for (const [kind, { traces, axes }] of Object.entries(SUBPLOT_KINDS)) {
    const pattern = new RegExp(`^${kind}\\d*$`);
    const ids = new Set([
      ...Object.keys(figure.layout).filter((key) => pattern.test(key)),
      ...figure.data.filter((trace) => traces.includes(trace.type)).map((trace) => trace.subplot ?? kind),
    ]);
    for (const id of ids) {
      const own = figure.layout[id] && typeof figure.layout[id] === "object" ? figure.layout[id] : {};
      out[id] = {
        bgcolor: colors.plot,
        ...own,
        ...Object.fromEntries(
          axes.map((axis) => [axis, { gridcolor: colors.grid, linecolor: colors.grid, ...(own[axis] && typeof own[axis] === "object" ? own[axis] : {}) }]),
        ),
      };
    }
  }
  return out;
}

const MENU_COLORS = {
  light: { background: "#C8D4E3", border: "#2a3f5f", text: "#2a3f5f" },
  dark: { background: "#C8D4E3", border: "#506784", text: "#2a3f5f" },
};

export function themedMenus(menus, mode) {
  const colors = MENU_COLORS[mode === "light" ? "light" : "dark"];
  return menus.map((menu) =>
    menu && typeof menu === "object"
      ? { bgcolor: colors.background, bordercolor: colors.border, ...menu, font: { color: colors.text, ...(menu.font && typeof menu.font === "object" ? menu.font : {}) } }
      : menu,
  );
}

export function themedFigure(figure, mode) {
  if (!followsTheme(figure)) return figure;
  const colors = FIGURE_COLORS[mode === "light" ? "light" : "dark"];
  const base = BASE_COLORS[mode === "light" ? "light" : "dark"];
  const geos = Object.fromEntries(
    geoSubplots(figure).map((id) => [
      id,
      {
        bgcolor: colors.paper,
        showland: true,
        landcolor: base.land,
        showocean: true,
        oceancolor: base.water,
        showlakes: true,
        lakecolor: base.water,
        coastlinecolor: base.coast,
        countrycolor: base.border,
        framecolor: base.border,
        ...(figure.layout[id] && typeof figure.layout[id] === "object" ? figure.layout[id] : {}),
      },
    ]),
  );
  const axis = (own) => ({ gridcolor: colors.grid, zerolinecolor: colors.grid, linecolor: colors.grid, ...(own && typeof own === "object" ? own : {}) });
  return {
    ...figure,
    layout: {
      ...figure.layout,
      paper_bgcolor: colors.paper,
      plot_bgcolor: colors.plot,
      font: { color: colors.font, ...(figure.layout.font ?? {}) },
      xaxis: axis(figure.layout.xaxis),
      yaxis: axis(figure.layout.yaxis),
      ...geos,
      ...themedSubplots(figure, colors),
      ...(Array.isArray(figure.layout.updatemenus) ? { updatemenus: themedMenus(figure.layout.updatemenus, mode) } : {}),
    },
  };
}


const columnsOf = (rows) => [...new Set(rows.flatMap((row) => Object.keys(row)))];
const cellOf = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : value);

const TABLE_COLORS = {
  light: { paper: "white", font: "#2a3f5f", header: "#C8D4E3", cells: "#EBF0F8", line: "white" },
  dark: { paper: "rgb(17,17,17)", font: "#f2f5fa", header: "#2a3f5f", cells: "#506784", line: "rgb(17,17,17)" },
};

function tableFigure(columns, values, mode) {
  const colors = TABLE_COLORS[mode === "light" ? "light" : "dark"];
  return {
    data: [
      {
        type: "table",
        header: { values: columns.map(String), fill: { color: colors.header }, line: { color: colors.line }, align: "left" },
        cells: { values, fill: { color: colors.cells }, line: { color: colors.line }, align: "left" },
      },
    ],
    layout: { paper_bgcolor: colors.paper, font: { color: colors.font }, margin: { l: 8, r: 8, t: 8, b: 8 } },
  };
}

function tableOf(rows, mode) {
  const columns = columnsOf(rows);
  return tableFigure(columns, columns.map((column) => rows.map((row) => cellOf(row[column]))), mode);
}

function listingOf(figure, mode) {
  const [header, ...rows] = pointRows(figure);
  return tableFigure(header, header.map((_, i) => rows.map((row) => cellOf(row[i]))), mode);
}

export const ACTION_RESET = "reset-view";
export const ACTION_SHOW_ALL = "show-all";
export const ACTION_COPY = "copy-figure";
export const ACTION_STATIC = "static";
const SAVE_DELAY_MS = 300;

export default {
  initialize({ model }) {
    const current = () => figureOf(model.get("data"));
    const rows = () => rowsOf(model.get("data"));
    const drawn = () => document.querySelector(".plotly-chart.js-plotly-plot");
    const svg = async () => {
      const graph = drawn();
      if (!graph) return null;
      const url = await window.Plotly.toImage(graph, { format: "svg", width: graph.clientWidth, height: graph.clientHeight });
      return decodeURIComponent(url.slice(url.indexOf(",") + 1));
    };
    const png = async () => {
      const graph = drawn();
      if (!graph) return null;
      const url = await window.Plotly.toImage(graph, { format: "png", width: graph.clientWidth, height: graph.clientHeight, scale: 2 });
      return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    };
    const image = (label) =>
      drawn()
        ? [
            { id: "png", label: `${label} (PNG)`, extension: "png", mime: "image/png" },
            { id: "svg", label: `${label} (SVG)`, extension: "svg", mime: "image/svg+xml" },
          ]
        : [];
    return {
      async exportOptions() {
        if (rows())
          return [
            { id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" },
            { id: "rows", label: "Rows (JSON)", extension: "json", mime: "application/json" },
            ...image("Table"),
          ];
        const figure = current();
        if (!figure) return [];
        const options = [{ id: "figure", label: "Figure (Plotly JSON)", extension: "json", mime: "application/json" }];
        if (csvOf(figure)) options.unshift({ id: "csv", label: "Data (CSV)", extension: "csv", mime: "text/csv" });
        return [...options, ...image("Chart")];
      },
      async exportData(id) {
        const table = rows();
        if (table) {
          const columns = columnsOf(table);
          if (id === "csv") return [columns, ...table.map((row) => columns.map((c) => cellOf(row[c])))].map(csvLine).join("\n");
          if (id === "rows") return JSON.stringify(table, null, 2);
        } else {
          const figure = current();
          if (!figure) return null;
          if (id === "csv") return csvOf(figure);
          if (id === "figure") return JSON.stringify(model.get("data"), null, 2);
        }
        if (id === "png") return png();
        return id === "svg" ? svg() : null;
      },
      async copilotContext() {
        const figure = current();
        return figure ? summary(figure, model.get("state")) : null;
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    const Plotly = await loadPlotly();
    const invoke = (name, msg, options) => experimental.invoke(name, msg, options);
    const notify = (level, text) => invoke("core:ui:notify", { level, text }).catch(() => {});
    const graph = document.createElement("div");
    graph.className = "plotly-chart";
    const message = document.createElement("p");
    message.className = "plotly-message";
    el.replaceChildren(graph, message);

    let pending = false;
    let latest = 0;
    let onBase = false;
    let followsMode = false;
    let axes = {};
    let visible = {};
    let saveTimer;
    const config = () => model.get("config") ?? {};

    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      const next = stateOf(model.get("state"), axes, visible);
      if (!next) return;
      model.set("state", next);
      model.save_changes();
    };
    const saveLater = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, SAVE_DELAY_MS);
    };
    const track = () => {
      graph.removeAllListeners?.("plotly_relayout");
      graph.removeAllListeners?.("plotly_restyle");
      graph.on?.("plotly_relayout", (event) => {
        axes = viewFromRelayout(event, axes);
        saveLater();
      });
      graph.on?.("plotly_restyle", ([update, indexes]) => {
        visible = visibilityFromRestyle(update, indexes, visible);
        saveLater();
      });
    };

    const draw = async () => {
      pending = !el.clientWidth || !el.clientHeight;
      if (pending) return;
      if (saveTimer) save();
      const turn = ++latest;
      const response = model.get("data");
      const table = rowsOf(response);
      const mode = model.get("theme")?.mode;
      const authored = table ? null : figureOf(response);
      const state = model.get("state") ?? {};
      const modebar = modebarOf(config(), model.get("definition"));
      axes = { ...(state.axes ?? {}) };
      visible = { ...(state.visible ?? {}) };
      const listed = !table && authored && config().dataTable === true && pointRows(authored) ? authored : null;
      followsMode = Boolean(table) || Boolean(listed) || Boolean(authored && followsTheme(authored));
      const figure = table
        ? tableOf(table, mode)
        : listed
          ? listingOf(listed, mode)
          : authored && themedFigure(viewed(authored, state), mode);
      if (!figure) {
        Plotly.purge(graph);
        message.textContent = "The endpoint did not return a Plotly figure.";
        return;
      }
      try {
        const outlines = topojsonNames(figure);
        if (outlines.length) await loadOutlines(invoke, outlines);
        if (hasLatex(figure.layout) || figure.data.some((trace) => hasLatex(trace)))
          await loadMathJax(invoke).catch((error) => console.warn("MathJax:", error));
        if (turn !== latest || signal.aborted) return;
        message.textContent = "";
        const show = async (shown) => {
          await Plotly.react(graph, {
            data: shown.data,
            layout: shown.layout,
            frames: shown.frames,
            config: { responsive: true, displaylogo: false, displayModeBar: modebar, modeBarButtonsToRemove: ["toImage"] },
          });
          track();
        };
        const maps = mapSubplots(figure);
        onBase = false;
        try {
          await show(withMapStyle(figure, maps));
        } catch (error) {
          if (!maps.length) throw error;
          Plotly.purge(graph);
          const mode = model.get("theme")?.mode === "light" ? "light" : "dark";
          const base = await loadBaseStyle(invoke, mode);
          if (turn !== latest || signal.aborted) return;
          onBase = true;
          await show(withMapStyle(figure, maps, base));
        }
      } catch (error) {
        if (turn !== latest || signal.aborted) return;
        Plotly.purge(graph);
        message.textContent = `The chart could not be drawn: ${error?.message ?? error}`;
      }
    };

    const seedModebar = () => {
      if (typeof config().modebar === "boolean" || model.get("definition")?.modebar !== true) return;
      model.set("config", { ...config(), modebar: true });
      model.save_changes();
    };
    const resetState = () => {
      axes = {};
      visible = {};
      save();
      draw();
    };
    const showAll = () => {
      const figure = figureOf(model.get("data"));
      if (!figure) return;
      visible = Object.fromEntries(figure.data.map((_, index) => [index, true]));
      save();
      draw();
    };
    const copyFigure = async () => {
      try {
        await invoke("core:clipboard:write", { text: JSON.stringify(model.get("data")) });
        notify("success", "The figure is on the clipboard.");
      } catch (error) {
        notify("error", error?.message ?? "The figure could not be copied.");
      }
    };
    const createStatic = async () => {
      const figure = figureOf(model.get("data"));
      if (!figure) {
        notify("warning", "A static chart needs a Plotly figure.");
        return;
      }
      const copy = staticOf(figure, model.get("state"));
      if (copy.error) {
        notify("warning", copy.error);
        return;
      }
      try {
        await invoke("core:dashboard:add-widget", { widget: "chart", data: copy.data });
      } catch (error) {
        notify("error", error?.message ?? "The static chart could not be added.");
      }
    };
    const onEvent = (event) => {
      if (event?.kind !== "workspace-event" || event.name !== "action") return;
      if (event.id === ACTION_RESET) resetState();
      else if (event.id === ACTION_SHOW_ALL) showAll();
      else if (event.id === ACTION_COPY) copyFigure();
      else if (event.id === ACTION_STATIC) createStatic();
    };
    const onState = () => {
      if (stateOf(model.get("state"), axes, visible) !== null) draw();
    };

    model.on("change:data", draw);
    model.on("change:config", draw);
    model.on("change:state", onState);
    model.on("change:theme", () => (followsMode || onBase) && draw());
    model.on("msg:custom", onEvent);
    seedModebar();
    draw();

    const resize = new ResizeObserver(() => (pending ? draw() : Plotly.Plots.resize(graph)));
    resize.observe(el);
    signal.addEventListener("abort", () => {
      if (saveTimer) save();
      resize.disconnect();
      model.off("msg:custom", onEvent);
      Plotly.purge(graph);
    });
  },
};
