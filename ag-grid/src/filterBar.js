/*
 * The active filters, above the grid: one chip per filtered column, saying what it keeps, with a
 * button that removes it, and Clear all. It shows only while a filter is on.
 */

const OPERATORS = {
  equals: "=",
  notEqual: "≠",
  lessThan: "<",
  lessThanOrEqual: "≤",
  greaterThan: ">",
  greaterThanOrEqual: "≥",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "begins with",
  endsWith: "ends with",
  blank: "is blank",
  notBlank: "is not blank",
  empty: "is empty",
  true: "is true",
  false: "is false",
};

const MAX_SET_VALUES = 3;

function valueText(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value.replace(/^(\d{4}-\d{2}-\d{2}) 00:00:00$/, "$1") : String(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** One condition of a column filter as text, such as `> 10`, `between 1 and 5` or `contains abc`. */
export function conditionText(model) {
  if (!model || typeof model !== "object") return "";
  if (Array.isArray(model.conditions)) {
    return model.conditions.map(conditionText).filter(Boolean).join(` ${String(model.operator || "AND").toLowerCase()} `);
  }
  if (model.filterType === "set") {
    const values = Array.isArray(model.values) ? model.values.map((v) => (v === null ? "(blank)" : valueText(v))) : [];
    if (!values.length) return "none";
    const shown = values.slice(0, MAX_SET_VALUES).join(", ");
    return values.length > MAX_SET_VALUES ? `in ${shown} +${values.length - MAX_SET_VALUES} more` : `in ${shown}`;
  }
  if (model.filterType === "multi") {
    return (Array.isArray(model.filterModels) ? model.filterModels : []).map(conditionText).filter(Boolean).join(" and ");
  }
  const from = model.filterType === "date" ? valueText(model.dateFrom) : valueText(model.filter);
  const to = model.filterType === "date" ? valueText(model.dateTo) : valueText(model.filterTo);
  if (model.type === "inRange") return `between ${from} and ${to}`;
  const operator = OPERATORS[model.type] ?? model.type ?? "";
  return ["blank", "notBlank", "empty", "true", "false"].includes(model.type) ? operator : `${operator} ${from}`.trim();
}

/** The chips of a filter model: [{ colId, label, text }]. `headerOf(colId)` names the column. */
export function filterChips(filterModel, headerOf = (colId) => colId) {
  if (!filterModel || typeof filterModel !== "object") return [];
  return Object.entries(filterModel)
    .filter(([, model]) => model)
    .map(([colId, model]) => ({ colId, label: headerOf(colId), text: conditionText(model) }));
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mounts the bar at the start of `container` and keeps it current. `enabled()` says whether the
 * card wants it. Returns a cleanup function and `refresh` for a setting change.
 */
export function mountFilterBar(api, container, { enabled = () => true, before = container.firstChild } = {}) {
  const doc = container.ownerDocument ?? document;
  const bar = element(doc, "div", "ag-grid-filter-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Active filters");
  bar.hidden = true;
  container.insertBefore(bar, before ?? null);

  const headerOf = (colId) => {
    const column = api.getColumn?.(colId);
    return column ? api.getDisplayNameForColumn(column, "header") || colId : colId;
  };

  const draw = () => {
    if (api.isDestroyed()) return;
    const advanced = api.getGridOption("enableAdvancedFilter") === true ? api.getAdvancedFilterModel?.() : null;
    const chips = advanced ? [] : filterChips(api.getFilterModel?.() ?? {}, headerOf);
    bar.replaceChildren();
    bar.hidden = !enabled() || (!chips.length && !advanced);
    if (bar.hidden) return;
    if (advanced) {
      const chip = element(doc, "span", "ag-grid-filter-chip");
      chip.append(element(doc, "span", "ag-grid-filter-chip-text", "Advanced filter"));
      const remove = element(doc, "button", "ag-grid-filter-chip-remove", "✕");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove the advanced filter");
      remove.addEventListener("click", () => api.setAdvancedFilterModel(null));
      chip.append(remove);
      bar.append(chip);
      return;
    }
    for (const { colId, label, text } of chips) {
      const chip = element(doc, "span", "ag-grid-filter-chip");
      chip.title = `${label} ${text}`;
      chip.append(element(doc, "span", "ag-grid-filter-chip-label", label), " ", element(doc, "span", "ag-grid-filter-chip-text", text));
      const remove = element(doc, "button", "ag-grid-filter-chip-remove", "✕");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove the filter on ${label}`);
      remove.addEventListener("click", () => {
        const model = { ...(api.getFilterModel() ?? {}) };
        delete model[colId];
        api.setFilterModel(model);
      });
      chip.append(remove);
      bar.append(chip);
    }
    if (chips.length > 1) {
      const clear = element(doc, "button", "ag-grid-filter-clear", "Clear all");
      clear.type = "button";
      clear.addEventListener("click", () => api.setFilterModel(null));
      bar.append(clear);
    }
  };

  const events = ["filterChanged", "displayedColumnsChanged", "advancedFilterBuilderVisibleChanged"];
  for (const name of events) api.addEventListener(name, draw);
  draw();
  return {
    refresh: draw,
    destroy() {
      if (!api.isDestroyed()) for (const name of events) api.removeEventListener(name, draw);
      bar.remove();
    },
  };
}
