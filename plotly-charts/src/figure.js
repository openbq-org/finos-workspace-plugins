const DTYPES = {
  int8: Int8Array,
  i1: Int8Array,
  uint8: Uint8Array,
  u1: Uint8Array,
  uint8c: Uint8ClampedArray,
  u1c: Uint8ClampedArray,
  int16: Int16Array,
  i2: Int16Array,
  uint16: Uint16Array,
  u2: Uint16Array,
  int32: Int32Array,
  i4: Int32Array,
  uint32: Uint32Array,
  u4: Uint32Array,
  float32: Float32Array,
  f4: Float32Array,
  float64: Float64Array,
  f8: Float64Array,
};

export function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || typeof value.bdata !== "string") return null;
  const Type = DTYPES[value.dtype];
  if (!Type) return null;
  const bytes = Uint8Array.from(atob(value.bdata), (c) => c.charCodeAt(0));
  const flat = Array.from(new Type(bytes.buffer, 0, Math.floor(bytes.length / Type.BYTES_PER_ELEMENT)));
  const shape = String(value.shape ?? "")
    .split(",")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => n > 0);
  if (shape.length !== 2) return flat;
  const [rows, columns] = shape;
  return Array.from({ length: rows }, (_, row) => flat.slice(row * columns, (row + 1) * columns));
}

export function titleOf(item) {
  const title = item?.title;
  return typeof title === "string" ? title : (title?.text ?? null);
}

export function csvLine(row) {
  return row
    .map((value) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(",");
}

const POINT_FIELDS = { candlestick: ["open", "high", "low", "close"], ohlc: ["open", "high", "low", "close"] };

export function pointRows(figure) {
  const series = figure.data
    .filter((trace) => trace.z === undefined)
    .map((trace, i) => {
      const fields = POINT_FIELDS[trace.type];
      const columns = fields
        ? fields.map((field) => ({ field, values: valuesOf(trace[field]) }))
        : [{ field: null, values: valuesOf(trace.y) ?? valuesOf(trace.values) }];
      const first = columns[0].values;
      const xs = valuesOf(trace.x) ?? valuesOf(trace.labels) ?? (first && first.map((_, j) => j));
      return { name: trace.name ?? `trace ${i + 1}`, xs, columns };
    })
    .filter((s) => s.xs && s.columns.every((c) => c.values && !c.values.some(Array.isArray)));
  if (!series.length) return null;
  const x = titleOf(figure.layout.xaxis) || "x";
  const y = titleOf(figure.layout.yaxis) || "y";
  const [first] = series;
  const shared = series.every(
    (s) => s.xs.length === first.xs.length && s.xs.every((value, i) => value === first.xs[i]),
  );
  const label = (s, c) => (c.field === null ? s.name : series.length > 1 ? `${s.name} ${c.field}` : c.field);
  const fields = [...new Set(series.flatMap((s) => s.columns.map((c) => c.field ?? y)))];
  return shared
    ? [
        [x, ...series.flatMap((s) => s.columns.map((c) => label(s, c)))],
        ...first.xs.map((value, i) => [value, ...series.flatMap((s) => s.columns.map((c) => c.values[i]))]),
      ]
    : [
        ["trace", x, ...fields],
        ...series.flatMap((s) =>
          s.xs.map((value, i) => [
            s.name,
            value,
            ...fields.map((field) => s.columns.find((c) => (c.field ?? y) === field)?.values[i]),
          ]),
        ),
      ];
}

export function csvOf(figure) {
  return pointRows(figure)?.map(csvLine).join("\n") ?? null;
}

export function summary(figure, view = null) {
  const traces = figure.data.map((trace) => {
    const grid = trace.z !== undefined;
    const ranged = POINT_FIELDS[trace.type] && [...(valuesOf(trace.low) ?? []), ...(valuesOf(trace.high) ?? [])];
    const values = ((grid ? valuesOf(trace.z) : (valuesOf(trace.y) ?? valuesOf(trace.values) ?? ranged)) ?? []).flat();
    const numbers = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    const points = grid ? values : (valuesOf(trace.x) ?? valuesOf(trace.labels) ?? valuesOf(trace.close) ?? values);
    return {
      name: trace.name ?? null,
      type: trace.type ?? "scatter",
      points: points.length,
      min: numbers.length ? numbers.reduce((a, b) => Math.min(a, b)) : null,
      max: numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : null,
    };
  });
  const result = { title: titleOf(figure.layout), traces };
  if (view?.axes && Object.keys(view.axes).length) result.zoom = view.axes;
  const hidden = Object.entries(view?.visible ?? {})
    .filter(([, shown]) => !shown)
    .map(([index]) => traces[Number(index)]?.name ?? `trace ${Number(index) + 1}`);
  if (hidden.length) result.hidden = hidden;
  return result;
}

const AXIS_KEY = /^((?:x|y)axis\d*)\.(range(?:\[([01])\])?|autorange)$/;
const MAX_VIEW_AXES = 16;

export function viewFromRelayout(event, axes = {}) {
  const next = { ...axes };
  for (const [key, value] of Object.entries(event ?? {})) {
    const match = AXIS_KEY.exec(key);
    if (!match) continue;
    const [, axis, field, end] = match;
    if (field === "autorange") {
      if (value) delete next[axis];
    } else if (end === undefined) {
      if (Array.isArray(value) && value.length === 2) next[axis] = [...value];
    } else {
      const range = [...(next[axis] ?? [null, null])];
      range[Number(end)] = value;
      next[axis] = range;
    }
  }
  return Object.fromEntries(Object.entries(next).slice(0, MAX_VIEW_AXES));
}

export function visibilityFromRestyle(update, indexes, visible = {}) {
  const values = update?.visible;
  if (!Array.isArray(values) || !values.length || !Array.isArray(indexes)) return visible;
  const next = { ...visible };
  indexes.forEach((index, i) => {
    const value = values[i % values.length];
    if (Number.isInteger(index) && index >= 0) next[index] = value === true;
  });
  return next;
}

const complete = (range) =>
  Array.isArray(range) && range.length === 2 && range.every((end) => typeof end === "number" || typeof end === "string");

export function modebarOf(config, definition) {
  return typeof config?.modebar === "boolean" ? config.modebar : definition?.modebar === true;
}

export function viewed(figure, state) {
  const axes = Object.entries(state?.axes ?? {}).filter(([axis, range]) => complete(range) && (axis === "xaxis" || axis === "yaxis" || figure.layout[axis]));
  const visible = state?.visible ?? {};
  if (!axes.length && !Object.keys(visible).length) return figure;
  const layout = { ...figure.layout };
  for (const [axis, range] of axes) layout[axis] = { ...(layout[axis] ?? {}), range, autorange: false };
  const data = figure.data.map((trace, index) =>
    visible[index] === undefined ? trace : { ...trace, visible: visible[index] ? true : "legendonly" },
  );
  return { ...figure, data, layout };
}

export function stateOf(state, axes, visible) {
  const next = {};
  if (Object.keys(axes).length) next.axes = axes;
  if (Object.keys(visible).length) next.visible = visible;
  return JSON.stringify(next) === JSON.stringify(state ?? {}) ? null : next;
}

export const MAX_STATIC_BYTES = 380_000;

export function staticOf(figure, state) {
  const shown = viewed(figure, state);
  const copy = { data: shown.data, layout: shown.layout };
  if (shown.frames?.length) copy.frames = shown.frames;
  const size = new TextEncoder().encode(JSON.stringify(copy)).byteLength;
  if (size > MAX_STATIC_BYTES)
    return { error: `The figure is ${Math.ceil(size / 1024)} KiB, and a static chart holds at most ${Math.floor(MAX_STATIC_BYTES / 1024)} KiB.` };
  return { data: copy };
}
