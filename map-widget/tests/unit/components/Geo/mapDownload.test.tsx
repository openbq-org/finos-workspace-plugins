import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapControls } from "~/components/Geo/MapControls";
import MapExportMenu from "~/components/Geo/MapExportMenu";
import { saveMapFile } from "~/components/Geo/mapDownload";
import * as host from "~/host";
import * as mapExport from "~/lib/geo/mapExport";
import { mapSpec } from "~/lib/geo/mapSpec";

vi.mock("~/host", () => ({ notify: vi.fn(), saveFile: vi.fn() }));

const SPEC = mapSpec({
  title: "Shipment lanes",
  points: [{ lat: 51.9, lon: 4.5, label: "Rotterdam" }],
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(host.notify).mockClear();
  vi.mocked(host.saveFile).mockReset().mockResolvedValue(undefined);
});

describe("saving a map as a file", () => {
  it("hands the file to the host and says its name", async () => {
    await saveMapFile(SPEC, "geojson", { name: "Shipment lanes" });
    expect(host.saveFile).toHaveBeenCalledTimes(1);
    const [name, mime, content] = vi.mocked(host.saveFile).mock.calls[0];
    expect(name).toBe("Shipment-lanes.geojson");
    expect(mime).toBe("application/geo+json");
    expect(JSON.parse(content as string).features[0].properties.name).toBe("Rotterdam");
    expect(host.notify).toHaveBeenCalledWith("info", "Saved Shipment-lanes.geojson");
  });

  it("says that a boundary file did not load when that is what failed, and saves nothing", async () => {
    vi.spyOn(mapExport, "exportShapes").mockRejectedValue(new Error("503"));
    await saveMapFile(SPEC, "kml");
    expect(host.saveFile).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith(
      "error",
      "The map could not be exported: a boundary file of its regions did not load. Try again.",
    );
  });

  it("says that the file could not be written when the writer fails, and that the host refused a save", async () => {
    vi.spyOn(mapExport, "writeMap").mockImplementation(() => {
      throw new RangeError("Array buffer allocation failed");
    });
    await saveMapFile(SPEC, "kmz");
    expect(host.saveFile).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith(
      "error",
      "The map could not be exported: the KMZ file could not be written (Array buffer allocation failed). A map with fewer marks or smaller images may fit.",
    );
    vi.mocked(mapExport.writeMap).mockRestore();
    vi.mocked(host.notify).mockClear();
    vi.mocked(host.saveFile).mockRejectedValue(new Error("blocked"));
    await saveMapFile(SPEC, "geojson");
    expect(host.notify).toHaveBeenCalledWith(
      "error",
      "The map could not be exported: the host did not save the file (blocked).",
    );
  });
});

describe("the export menu of a map", () => {
  it("offers KML, KMZ and GeoJSON from its button, and asks for the format that is chosen", async () => {
    const onExport = vi.fn();
    render(
      <MapExportMenu onExport={onExport}>
        <button type="button">Export map</button>
      </MapExportMenu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export map" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "KML",
      "KMZ",
      "GeoJSON",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "KMZ" }));
    expect(onExport).toHaveBeenCalledWith("kmz");
  });

  it("is in the controls of a map that can be exported, and of no other", async () => {
    const onExport = vi.fn();
    const { rerender } = render(
      <MapControls onZoom={vi.fn()} onReset={vi.fn()} onExport={onExport} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export map" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "GeoJSON" }));
    expect(onExport).toHaveBeenCalledWith("geojson");
    rerender(<MapControls onZoom={vi.fn()} onReset={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Export map" })).toBeNull();
  });
});
