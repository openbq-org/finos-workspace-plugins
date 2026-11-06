const TITLE = /^title\s+(.+)$/i;
const HEADER = /^pie\b(?:\s+(showData))?(?:\s+title\s+(.+))?$/i;
const SLICE = /^\s*(?:"([^"]*)"|'([^']*)')\s*:\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parsePie(source) {
  const lines = String(source)
    .split(/\r?\n/)
    .map((line) => line.replace(/%%.*$/, "").trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => !/^(---|\w+:|\s)/.test(line) || /^pie\b/i.test(line));
  const header = lines[start] ? HEADER.exec(lines[start]) : null;
  if (!header) return null;
  let title = header[2]?.trim() ?? "";
  const slices = [];
  for (const line of lines.slice(start + 1)) {
    const named = TITLE.exec(line);
    if (named) {
      title = named[1].trim();
      continue;
    }
    const slice = SLICE.exec(line);
    if (!slice) continue;
    const value = Number(slice[3]);
    if (value > 0) slices.push({ label: slice[1] ?? slice[2], value });
  }
  if (!slices.length) return null;
  slices.sort((a, b) => b.value - a.value);
  return { title, showData: Boolean(header[1]), slices };
}

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const number = (value) => Math.round(value * 100) / 100;

function arcPath(cx, cy, outer, inner, from, to) {
  if (to - from >= Math.PI * 2 - 1e-6) {
    const ring = (r) => `M${number(cx + r)},${number(cy)}A${r},${r} 0 1 1 ${number(cx - r)},${number(cy)}A${r},${r} 0 1 1 ${number(cx + r)},${number(cy)}`;
    return `${ring(outer)}${ring(inner)}`;
  }
  const point = (r, angle) => `${number(cx + r * Math.sin(angle))},${number(cy - r * Math.cos(angle))}`;
  const large = to - from > Math.PI ? 1 : 0;
  return `M${point(outer, from)}A${number(outer)},${number(outer)} 0 ${large} 1 ${point(outer, to)}L${point(inner, to)}A${number(inner)},${number(inner)} 0 ${large} 0 ${point(inner, from)}Z`;
}

export function pieSvg(pie, { width, height, colors, locale = "en-US", interactive = true }) {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const total = pie.slices.reduce((sum, slice) => sum + slice.value, 0);
  const pad = 20;
  const titleHeight = pie.title ? 32 : 0;
  const top = pad + titleHeight;
  const area = { x: pad, y: top, w: width - pad * 2, h: height - top - pad };
  const row = 26;
  const labelWidth = Math.max(...pie.slices.map((slice) => slice.label.length)) * 7.4;
  const valueWidth = pie.showData ? Math.max(...pie.slices.map((slice) => format.format(slice.value).length)) * 8 + 16 : 0;
  const legendWidth = Math.min(Math.max(labelWidth + valueWidth + 76, 150), Math.max(area.w * 0.46, 150));
  const donutBox = { w: area.w - legendWidth - pad, h: area.h };
  const radius = Math.max(Math.min(donutBox.w, donutBox.h) / 2, 40);
  const cx = area.x + donutBox.w / 2;
  const cy = area.y + area.h / 2;
  const inner = radius * 0.62;
  const font = `font-family="${escape(colors.font)}"`;
  const fit = Math.max(Math.floor(area.h / row), 1);
  const rows = pie.slices.length > fit ? fit - 1 : pie.slices.length;
  const legendX = area.x + donutBox.w + pad;
  const legendY = area.y + (area.h - (rows + (pie.slices.length > rows ? 1 : 0)) * row) / 2;
  const maxChars = Math.max(Math.floor((legendWidth - valueWidth - 76) / 7.2), 6);

  let angle = 0;
  const arcs = [];
  const entries = [];
  pie.slices.forEach((slice, i) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const fill = colors.series[i % colors.series.length];
    arcs.push(`<path class="pie-slice" data-i="${i}" fill="${escape(fill)}" stroke="${escape(colors.gap)}" stroke-width="2" d="${arcPath(cx, cy, radius, inner, angle, angle + sweep)}"/>`);
    angle += sweep;
    if (i >= rows) return;
    const y = legendY + i * row + row / 2;
    const clipped = slice.label.length > maxChars ? `${slice.label.slice(0, maxChars - 1)}…` : slice.label;
    const detail = pie.showData ? `${format.format(slice.value)} · ${percent.format(slice.value / total)}` : percent.format(slice.value / total);
    entries.push(
      `<g class="pie-row" data-i="${i}"><rect x="${legendX - 6}" y="${y - row / 2}" width="${legendWidth + 6}" height="${row}" rx="6" fill="transparent"/>` +
        `<circle cx="${legendX + 5}" cy="${y}" r="5" fill="${escape(fill)}"/>` +
        `<text x="${legendX + 18}" y="${y}" dominant-baseline="central" font-size="13" ${font} fill="${escape(colors.text)}">${escape(clipped)}<title>${escape(slice.label)}</title></text>` +
        `<text x="${legendX + legendWidth}" y="${y}" dominant-baseline="central" text-anchor="end" font-size="12" ${font} fill="${escape(colors.muted)}">${escape(detail)}</text></g>`,
    );
  });
  if (pie.slices.length > rows) {
    const y = legendY + rows * row + row / 2;
    entries.push(`<text x="${legendX + 18}" y="${y}" dominant-baseline="central" font-size="12" ${font} fill="${escape(colors.muted)}">+${pie.slices.length - rows} more</text>`);
  }

  const centre =
    `<text class="pie-centre-value" x="${cx}" y="${cy - radius * 0.06}" text-anchor="middle" dominant-baseline="central" font-size="${number(radius * 0.3)}" font-weight="600" ${font} fill="${escape(colors.text)}" data-total="${escape(format.format(total))}">${escape(format.format(total))}</text>` +
    `<text class="pie-centre-label" x="${cx}" y="${cy + radius * 0.24}" text-anchor="middle" dominant-baseline="central" font-size="${number(Math.max(radius * 0.115, 11))}" ${font} fill="${escape(colors.muted)}" data-total="Total">Total</text>`;
  const heading = pie.title
    ? `<text x="${pad}" y="${pad + 12}" font-size="16" font-weight="600" ${font} fill="${escape(colors.text)}">${escape(pie.title)}</text>`
    : "";
  const spec = pie.slices.map((slice) => ({ label: slice.label, value: format.format(slice.value), share: percent.format(slice.value / total) }));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pie" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(pie.title || "Pie chart")}"${interactive ? ` data-slices="${escape(JSON.stringify(spec))}"` : ""}>` +
    `${colors.background ? `<rect width="${width}" height="${height}" fill="${escape(colors.background)}"/>` : ""}${heading}${arcs.join("")}${centre}${entries.join("")}</svg>`
  );
}
