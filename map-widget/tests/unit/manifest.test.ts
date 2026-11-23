import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION } from "~/cardActions";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const [widget] = manifest.contributes.widgets;

const VIEW = ["latitude", "longitude", "zoom", "bearing", "pitch"];

const HOST_ICONS = new Set([
  "bell", "calendar", "chart", "check", "clock", "code", "columns", "copy", "database", "download", "edit", "eye", "filter",
  "globe", "grid", "info", "link", "lock", "maximize", "pie-chart", "play", "refresh", "search", "settings", "sliders",
  "sparkles", "star", "table", "upload", "zap", "zoom-in", "zoom-out",
]);
const ICON_TAGS = new Set(["circle", "desc", "ellipse", "g", "line", "path", "polygon", "polyline", "rect", "svg", "title"]);
const ICON_ATTRIBUTES = new Set([
  "clip-rule", "cx", "cy", "d", "fill", "fill-opacity", "fill-rule", "height", "opacity", "points", "r", "rx", "ry", "stroke",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
  "stroke-width", "transform", "viewBox", "width", "x", "x1", "x2", "y", "y1", "y2", "xmlns",
]);

describe("the manifest", () => {
  it("handles the map type and asks for what the module uses", () => {
    expect(widget.handles.map((handle: { type: string }) => handle.type)).toEqual([
      "map",
    ]);
    expect(widget.permissions).toEqual(
      expect.arrayContaining([
        "core:data:read",
        "core:export:provide",
        "core:copilot:context",
        "core:state:write",
        "core:clipboard:write",
        "core:download:save",
        "core:ui:notify",
      ]),
    );
    expect(widget.model.traits.state).toEqual({ bind: "state", access: "readwrite" });
  });

  it("asks for the permission of every command that the host module sends", () => {
    const sent = [...readFileSync(join(process.cwd(), "src/host.ts"), "utf8").matchAll(/"(core:[a-z]+:[a-z-]+)"/g)].map(
      (found) => found[1],
    );
    expect(sent.length).toBeGreaterThan(3);
    for (const command of sent)
      if (command !== "core:asset:read") expect(widget.permissions, command).toContain(command);
  });

  it("asks for the tile service of its basemap and for nothing else on the network", () => {
    expect(manifest.csp).toEqual({ "connect-src": ["https://tiles.openfreemap.org"] });
    expect(Object.keys(manifest.cspNotes)).toEqual(["connect-src"]);
    expect(widget.server).toBeUndefined();
  });

  it("binds the admin settings of the basemap and of the map sources as traits", () => {
    const { traits } = widget.model;
    expect(traits.mapTilesProvider.bind).toBe("adminSettings:mapTilesProvider");
    expect(traits.mapTilesUrl.bind).toBe("adminSettings:mapTilesUrl");
    expect(traits.mapSources.bind).toBe("adminSettings:mapSources");
    expect(manifest.adminSettings.defaults.mapTilesProvider).toBe("openfreemap");
  });

  it("describes the data.map object with a closed schema", () => {
    const { definition } = widget.handles[0];
    expect(definition.type).toBe("object");
    expect(definition.additionalProperties).toBe(false);
    expect(Object.keys(definition.properties)).toEqual(
      expect.arrayContaining(["lat", "lon", "state", "country", "value", "category"]),
    );
  });

  it("gives the agent an artifact with a closed schema", () => {
    expect(widget.artifact.data.additionalProperties).toBe(false);
    expect(widget.artifact.description.length).toBeLessThanOrEqual(300);
  });

  it("lets the agent set where the map opens", () => {
    const { view } = widget.artifact.data.properties;
    expect(view.additionalProperties).toBe(false);
    expect(Object.keys(view.properties)).toEqual(
      expect.arrayContaining(["place", "center", "zoom", "bounds"]),
    );
  });

  it("shares the view with the settings, which the agent reads and sets", () => {
    const keys = Object.keys(widget.settings.schema.properties);
    expect(keys).toEqual([...VIEW, "dataTable"]);
    const bound = Object.values(widget.model.traits as Record<string, { bind: string }>)
      .map(({ bind }) => bind)
      .filter((bind) => bind.startsWith("config:"));
    expect(bound.sort()).toEqual(keys.map((key) => `config:${key}`).sort());
    expect(
      Object.values(widget.model.traits as Record<string, { bind: string; access: string }>)
        .filter(({ bind }) => bind.startsWith("config:"))
        .every(({ access }) => access === "readwrite"),
    ).toBe(true);
    expect(widget.permissions).toContain("core:config:write");
  });

  it("puts its buttons and menu items where the host draws them, with the permission of each", () => {
    const { actions } = widget;
    expect(actions.map(({ id }: { id: string }) => id).sort()).toEqual(Object.values(ACTION).sort());
    const placed = (placement: string) => actions.filter((action: { placement: string }) => action.placement === placement);
    expect(placed("navbar").length).toBeGreaterThan(0);
    expect(placed("navbar").length).toBeLessThanOrEqual(3);
    expect(placed("menu").length).toBeGreaterThan(0);
    expect(placed("menu").length).toBeLessThanOrEqual(8);
    expect(widget.permissions).toContain("core:ui:button");
    expect(widget.permissions).toContain("core:ui:menu");
    for (const action of actions) {
      expect(action.id).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.label.length).toBeLessThanOrEqual(40);
    }
  });

  it("switches the data table with a boolean setting of a button, which the module also writes", () => {
    const toggling = widget.actions.filter((action: { toggles?: string }) => action.toggles);
    expect(toggling.map((action: { id: string; placement: string; toggles: string }) => [action.id, action.placement, action.toggles])).toEqual([
      [ACTION.dataTable, "navbar", "dataTable"],
    ]);
    expect(widget.settings.schema.properties.dataTable.type).toBe("boolean");
    expect(widget.model.traits.dataTable).toEqual({ bind: "config:dataTable", access: "readwrite" });
  });

  it("adds a widget of its own only from an action that toggles nothing, and only the widget that takes an artifact", () => {
    expect(widget.permissions).toContain("core:dashboard:add-widget");
    expect(widget.actions.some((action: { toggles?: string }) => !action.toggles)).toBe(true);
    expect(widget.artifact).toBeDefined();
    expect(readFileSync(join(root, "src/staticMap.ts"), "utf8")).toContain(`STATIC_WIDGET = "${widget.id}"`);
  });

  it("draws its icons from the host's or from SVG files that the host's rules allow", () => {
    const own = widget.actions.map((action: { icon: string }) => action.icon).filter((icon: string) => !HOST_ICONS.has(icon));
    expect(own.sort()).toEqual(["assets/fit.svg", "assets/static-map.svg"]);
    for (const icon of own) {
      expect(icon).toMatch(/^assets\/[A-Za-z0-9._-]{1,100}\.svg$/);
      const text = readFileSync(join(root, "src", icon), "utf8");
      expect(text.length).toBeLessThanOrEqual(16 * 1024);
      expect(text).not.toMatch(/<!|<\?|&|url\(|javascript:/i);
      const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
      expect(svg.localName).toBe("svg");
      for (const node of [svg, ...svg.querySelectorAll("*")]) {
        expect(ICON_TAGS.has(node.localName), node.localName).toBe(true);
        for (const attribute of node.attributes) expect(ICON_ATTRIBUTES.has(attribute.name), attribute.name).toBe(true);
      }
      expect(svg.getAttribute("fill")).toBe("none");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("lists skill files that exist", () => {
    for (const skill of manifest.contributes.skills) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(skill.description.length).toBeLessThanOrEqual(300);
      expect(existsSync(join(root, "src", skill.file))).toBe(true);
    }
  });
});
