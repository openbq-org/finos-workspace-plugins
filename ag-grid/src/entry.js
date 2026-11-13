import file from "./file.js";
import infinite from "./infinite.js";
import sql from "./sql.js";
import ssrm from "./ssrm.js";
import streaming from "./streaming.js";
import table from "./table.js";

export const WIDGETS = { table, ssrm, infinite, streaming, file, sql };

let widget = null;

export default {
  initialize(args) {
    widget = WIDGETS[args.model.get("meta")?.widgetId];
    if (!widget) throw new Error("This plugin has no widget by that id.");
    return widget.initialize(args);
  },
  render(args) {
    return widget.render(args);
  },
};
