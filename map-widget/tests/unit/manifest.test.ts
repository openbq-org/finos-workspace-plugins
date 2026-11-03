import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "src/plugin.json"), "utf8"));
const [widget] = manifest.contributes.widgets;

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

  it("lists skill files that exist", () => {
    for (const skill of manifest.contributes.skills) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(skill.description.length).toBeLessThanOrEqual(300);
      expect(existsSync(join(root, "src", skill.file))).toBe(true);
    }
  });
});
