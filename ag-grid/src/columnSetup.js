/*
 * Column setup: the user's own settings for each column of a card (header, format, decimals,
 * prefix, suffix, green and red, chart role, hidden), made in a side bar panel and saved with the
 * card. They are laid over the widget's columnsDefs, so a backend's configuration stays the
 * default and the user's choice wins.
 */

export const SETUP_PANEL = "column-setup";
export const FORMATS = ["", "int", "none", "percent", "normalized", "normalizedPercent", "compact", "dateToYear"];
export const ROLES = ["", "category", "series", "time", "excluded"];
const MAX_COLUMNS = 200;
const TEXT = 100;

function text(value, max = TEXT) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

/** The setup saved with a card, kept only where it fits: { [field]: { ... } }. */
export function savedSetup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [field, s] of Object.entries(value).slice(0, MAX_COLUMNS)) {
    if (!s || typeof s !== "object" || field.length > 128) continue;
    const entry = {};
    if (text(s.headerName)) entry.headerName = text(s.headerName);
    if (FORMATS.includes(s.formatterFn) && s.formatterFn) entry.formatterFn = s.formatterFn;
    if (Number.isInteger(s.decimalPlaces) && s.decimalPlaces >= 0 && s.decimalPlaces <= 12) entry.decimalPlaces = s.decimalPlaces;
    if (text(s.prefix, 16) !== undefined && s.prefix !== "") entry.prefix = text(s.prefix, 16);
    if (text(s.suffix, 16) !== undefined && s.suffix !== "") entry.suffix = text(s.suffix, 16);
    if (typeof s.greenRed === "boolean") entry.greenRed = s.greenRed;
    if (ROLES.includes(s.chartDataType) && s.chartDataType) entry.chartDataType = s.chartDataType;
    if (typeof s.hide === "boolean") entry.hide = s.hide;
    if (Object.keys(entry).length) out[field] = entry;
  }
  return out;
}

/** The definition with the setup laid over its columnsDefs; a column it does not declare is added. */
export function withColumnSetup(definition, setup) {
  const fields = Object.keys(setup ?? {});
  if (!fields.length) return definition;
  const defs = Array.isArray(definition?.columnsDefs) ? definition.columnsDefs.map((d) => ({ ...d })) : [];
  for (const field of fields) {
    const { greenRed, ...own } = setup[field];
    let def = defs.find((d) => d.field === field);
    if (!def) {
      def = { field };
      defs.push(def);
    }
    Object.assign(def, own);
    if (typeof greenRed === "boolean") {
      const fns = (Array.isArray(def.renderFn) ? def.renderFn : def.renderFn ? [def.renderFn] : []).filter((fn) => fn !== "greenRed");
      if (greenRed) fns.push("greenRed");
      def.renderFn = fns.length > 1 ? fns : fns[0];
      if (def.renderFn === undefined) delete def.renderFn;
    }
  }
  return { ...definition, columnsDefs: defs };
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/**
 * The Column setup tool panel (an AG Grid tool panel component). Its params give `columns()`
 * ({ field, label }), `setup()` and `save(setup)`.
 */
export class ColumnSetupPanel {
  init(params) {
    this.params = params;
    this.gui = element("div", "ag-grid-setup");
    this.draw();
  }

  getGui() {
    return this.gui;
  }

  refresh() {
    this.draw();
    return true;
  }

  draw() {
    const setup = { ...this.params.setup() };
    const columns = this.params.columns();
    this.gui.replaceChildren();
    this.gui.append(element("p", "ag-grid-setup-note", "Your settings for this card's columns. They replace the widget's own and are saved with the card."));
    const list = element("div", "ag-grid-setup-list");
    const draft = {};
    for (const { field, label } of columns) {
      const current = setup[field] ?? {};
      const row = (draft[field] = { ...current });
      const box = element("fieldset", "ag-grid-setup-column");
      box.append(element("legend", "ag-grid-setup-field", label === field ? field : `${label} (${field})`));
      const input = (key, placeholder, width, max = TEXT) => {
        const node = element("input", "ag-grid-setup-input");
        node.placeholder = placeholder;
        node.maxLength = max;
        node.style.width = width;
        node.value = row[key] ?? "";
        node.setAttribute("aria-label", `${label}: ${placeholder}`);
        node.addEventListener("input", () => {
          row[key] = node.value;
        });
        return node;
      };
      const select = (key, options, labels, aria) => {
        const node = element("select", "ag-grid-setup-input");
        node.setAttribute("aria-label", `${label}: ${aria}`);
        options.forEach((value, i) => {
          const option = element("option", undefined, labels[i]);
          option.value = value;
          option.selected = (row[key] ?? "") === value;
          node.append(option);
        });
        node.addEventListener("change", () => {
          row[key] = node.value;
        });
        return node;
      };
      const check = (key, caption) => {
        const wrap = element("label", "ag-grid-setup-check");
        const node = element("input");
        node.type = "checkbox";
        node.checked = row[key] === true;
        node.addEventListener("change", () => {
          row[key] = node.checked;
        });
        wrap.append(node, ` ${caption}`);
        return wrap;
      };
      const decimals = element("input", "ag-grid-setup-input");
      decimals.type = "number";
      decimals.min = "0";
      decimals.max = "12";
      decimals.placeholder = "dp";
      decimals.style.width = "4em";
      decimals.value = row.decimalPlaces ?? "";
      decimals.setAttribute("aria-label", `${label}: decimal places`);
      decimals.addEventListener("input", () => {
        row.decimalPlaces = decimals.value === "" ? undefined : Number(decimals.value);
      });
      box.append(
        input("headerName", "Header", "100%"),
        select("formatterFn", FORMATS, ["Format: as it comes", "Whole number", "As is", "Percent", "× 100", "× 100 %", "Short (45.0B)", "Year"], "format"),
        decimals,
        input("prefix", "Prefix", "4em", 16),
        input("suffix", "Suffix", "4em", 16),
        select("chartDataType", ROLES, ["Chart: auto", "Category", "Series", "Time", "Not charted"], "chart role"),
        check("greenRed", "Green / red"),
        check("hide", "Hidden"),
      );
      list.append(box);
    }
    const save = element("button", "ag-grid-setup-save", "Apply");
    save.type = "button";
    save.addEventListener("click", () => {
      this.params.save(savedSetup(draft));
      this.draw();
    });
    const reset = element("button", "ag-grid-setup-reset", "Reset to the widget's settings");
    reset.type = "button";
    reset.addEventListener("click", () => {
      this.params.save({});
      this.draw();
    });
    const actions = element("div", "ag-grid-setup-actions");
    actions.append(save, reset);
    this.gui.append(actions, list);
  }
}
