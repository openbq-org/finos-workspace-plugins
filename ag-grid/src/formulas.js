/*
 * Formulas: columns a user adds to a card, such as `[Revenue] / [Shares]` or
 * `ROUND(AVG([Q1], [Q2], [Q3], [Q4]), 2)`. A formula names other columns by their header or their
 * field, in brackets, and may use another formula. The plugin evaluates them with its own
 * expression engine (never as code). They are saved with the card, in its state.
 */
import { compileExpression, FUNCTIONS } from "./ag-table-chart/expression.js";

export const MAX_FORMULAS = 20;
export const MAX_FORMULA_NAME = 60;
export const MAX_FORMULA_TEXT = 500;
export const FORMULA_PREFIX = "formula_";
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);

/** The columns a formula can name: [{ colId, label }], from the grid's column definitions. */
export function formulaColumnsOf(columnDefs) {
  const out = [];
  const walk = (defs) => {
    for (const def of defs ?? []) {
      if (Array.isArray(def.children)) walk(def.children);
      else if (def.colId ?? def.field) out.push({ colId: def.colId ?? def.field, label: def.headerName ?? def.field ?? def.colId });
    }
  };
  walk(columnDefs);
  return out;
}

/**
 * Turns `[Header]` and `[field]` references into the column ids the engine reads, and checks the
 * formula. Returns { expression, error }: `error` is a sentence for the user, or null.
 */
export function resolveFormula(text, columns, { self } = {}) {
  if (typeof text !== "string" || !text.trim()) return { expression: "", error: "Write a formula, such as [Revenue] / [Shares]." };
  if (text.length > MAX_FORMULA_TEXT) return { expression: "", error: `A formula has at most ${MAX_FORMULA_TEXT} characters.` };
  const byName = new Map();
  for (const { colId, label } of columns) {
    byName.set(String(colId).toLowerCase(), colId);
    if (label) byName.set(String(label).toLowerCase(), colId);
  }
  const unknown = [];
  const expression = text.replace(/\[([^\]]*)\]/g, (whole, name) => {
    const colId = byName.get(name.trim().toLowerCase());
    if (!colId) {
      unknown.push(name.trim());
      return whole;
    }
    if (self && colId === self) unknown.push(`${name.trim()} (the formula itself)`);
    return `[${colId}]`;
  });
  if (unknown.length) return { expression, error: `Unknown column: ${unknown.join(", ")}.` };
  try {
    compileExpression(expression);
  } catch (error) {
    return { expression, error: `The formula cannot be read: ${error.message}.` };
  }
  return { expression, error: null };
}

/** The formulas saved with a card, kept only when well formed. */
export function savedFormulas(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f) => f && typeof f.id === "string" && /^[a-z0-9]{1,16}$/.test(f.id) && typeof f.name === "string" && typeof f.formula === "string")
    .slice(0, MAX_FORMULAS)
    .map(({ id, name, formula }) => ({ id, name: name.slice(0, MAX_FORMULA_NAME), formula: formula.slice(0, MAX_FORMULA_TEXT) }));
}

/**
 * The column definitions of the formulas: each a calculated column the grid evaluates per row,
 * which can be sorted, filtered, aggregated, pivoted and charted. A formula that no longer reads
 * (a column is gone) shows #ERROR.
 */
export function formulaColumnDefs(formulas, columnDefs) {
  const own = formulas.map((f) => ({ colId: `${FORMULA_PREFIX}${f.id}`, label: f.name }));
  const columns = [...formulaColumnsOf(columnDefs), ...own];
  return formulas.map((f) => {
    const colId = `${FORMULA_PREFIX}${f.id}`;
    const { expression, error } = resolveFormula(f.formula, columns, { self: colId });
    return {
      colId,
      headerName: f.name,
      headerTooltip: `Formula: ${f.formula}`,
      calculatedExpression: error ? "1 / 0" : expression,
      chartDataType: "series",
      enableValue: true,
      cellClass: "ag-grid-formula-cell",
    };
  });
}

export function newFormulaId(formulas) {
  const used = new Set(formulas.map((f) => f.id));
  for (let n = formulas.length + 1; ; n++) {
    const id = `f${n}`;
    if (!used.has(id)) return id;
  }
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The Formulas tool panel of the side bar (an AG Grid tool panel component). Its params give
 * `formulas()`, `save(list)` and `columns()`.
 */
export class FormulasPanel {
  init(params) {
    this.params = params;
    const doc = document;
    this.doc = doc;
    this.editing = null;
    this.gui = element(doc, "div", "ag-grid-formulas");
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
    const { doc } = this;
    const formulas = this.params.formulas();
    this.gui.replaceChildren();

    const list = element(doc, "ul", "ag-grid-formulas-list");
    for (const formula of formulas) {
      const item = element(doc, "li", "ag-grid-formulas-item");
      const text = element(doc, "div", "ag-grid-formulas-item-text");
      text.append(element(doc, "div", "ag-grid-formulas-name", formula.name), element(doc, "code", "ag-grid-formulas-code", formula.formula));
      const edit = element(doc, "button", "ag-grid-formulas-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => {
        this.editing = formula.id;
        this.draw();
      });
      const remove = element(doc, "button", "ag-grid-formulas-button", "Delete");
      remove.type = "button";
      remove.setAttribute("aria-label", `Delete ${formula.name}`);
      remove.addEventListener("click", () => {
        this.params.save(formulas.filter((f) => f.id !== formula.id));
        if (this.editing === formula.id) this.editing = null;
        this.draw();
      });
      item.append(text, edit, remove);
      list.append(item);
    }
    if (!formulas.length) list.append(element(doc, "li", "ag-grid-formulas-empty", "No formulas yet. A formula adds a column computed from the others."));
    this.gui.append(list);
    this.gui.append(this.form(formulas));
  }

  form(formulas) {
    const { doc } = this;
    const current = formulas.find((f) => f.id === this.editing) ?? null;
    const form = element(doc, "form", "ag-grid-formulas-form");
    form.noValidate = true;
    form.append(element(doc, "div", "ag-grid-formulas-title", current ? `Edit ${current.name}` : "New formula"));

    const name = element(doc, "input", "ag-grid-formulas-input");
    name.placeholder = "Name, such as Margin";
    name.maxLength = MAX_FORMULA_NAME;
    name.value = current?.name ?? "";
    name.setAttribute("aria-label", "Formula name");

    const text = element(doc, "textarea", "ag-grid-formulas-input ag-grid-formulas-text");
    text.placeholder = "[Revenue] - [Cost]";
    text.maxLength = MAX_FORMULA_TEXT;
    text.rows = 3;
    text.value = current?.formula ?? "";
    text.setAttribute("aria-label", "Formula");

    const insert = element(doc, "select", "ag-grid-formulas-input");
    insert.setAttribute("aria-label", "Insert a column");
    const option = (label, value) => {
      const node = element(doc, "option", undefined, label);
      node.value = value;
      return node;
    };
    insert.append(option("Insert a column…", ""));
    const columns = this.params.columns().filter((c) => c.colId !== `${FORMULA_PREFIX}${current?.id}`);
    for (const column of columns) insert.append(option(column.label, column.label));
    insert.addEventListener("change", () => {
      if (!insert.value) return;
      const at = text.selectionStart ?? text.value.length;
      const token = `[${insert.value}]`;
      text.value = `${text.value.slice(0, at)}${token}${text.value.slice(text.selectionEnd ?? at)}`;
      insert.value = "";
      text.focus();
      check();
    });

    const help = element(doc, "div", "ag-grid-formulas-help", `+ - * / % ( ) and ${FORMULA_FUNCTIONS.join(", ")}, such as ROUND(AVG([Q1], [Q2]), 2).`);
    const message = element(doc, "div", "ag-grid-formulas-message");
    message.setAttribute("role", "status");

    const problem = () => {
      const label = name.value.trim();
      if (!label) return "Give the formula a name.";
      const others = new Set(this.params.columns().filter((c) => c.colId !== `${FORMULA_PREFIX}${current?.id}`).map((c) => String(c.label).toLowerCase()));
      if (others.has(label.toLowerCase())) return `There is already a column named ${label}.`;
      if (!current && formulas.length >= MAX_FORMULAS) return `A card has at most ${MAX_FORMULAS} formulas.`;
      return resolveFormula(text.value, this.params.columns(), { self: current ? `${FORMULA_PREFIX}${current.id}` : undefined }).error;
    };
    const check = () => {
      const error = problem();
      message.textContent = error ?? "";
      message.dataset.state = error ? "error" : "ok";
      save.disabled = Boolean(error);
      return error;
    };

    const save = element(doc, "button", "ag-grid-formulas-button ag-grid-formulas-save", current ? "Save" : "Add column");
    save.type = "submit";
    const cancel = element(doc, "button", "ag-grid-formulas-button", "Cancel");
    cancel.type = "button";
    cancel.hidden = !current;
    cancel.addEventListener("click", () => {
      this.editing = null;
      this.draw();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (check()) return;
      const entry = { id: current?.id ?? newFormulaId(formulas), name: name.value.trim(), formula: text.value.trim() };
      this.params.save(current ? formulas.map((f) => (f.id === current.id ? entry : f)) : [...formulas, entry]);
      this.editing = null;
      this.draw();
    });
    name.addEventListener("input", check);
    text.addEventListener("input", check);
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
    });

    const actions = element(doc, "div", "ag-grid-formulas-actions");
    actions.append(save, cancel);
    form.append(name, text, insert, help, message, actions);
    check();
    if (!name.value && !text.value) message.textContent = "";
    return form;
  }
}
