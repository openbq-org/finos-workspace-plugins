import { Collector } from "./collect";
import { type DbfTable, readDbf } from "./dbf";
import { decodeText, encodingNamed, type TextEncoding } from "./encodings";
import { GEO_FILE_LIMITS as LIMITS } from "./limits";
import { classifyPrj, fromWebMercator } from "./prj";
import { LayerLeftOut, readShp, type Shape, same } from "./shp";
import type { GeoFileResult } from "./types";
import { failFile } from "./types";
import type { Archive, ArchiveEntry } from "./zip";

const LANGUAGE_DRIVERS: Record<number, TextEncoding> = {
  3: "windows-1252",
  87: "windows-1252",
  88: "windows-1252",
  89: "windows-1252",
};

interface Layer {
  name: string;
  shp: ArchiveEntry;
  dbf?: ArchiveEntry;
  prj?: ArchiveEntry;
  cpg?: ArchiveEntry;
}

const SMALL_TEXT_BYTES = 64 * 1024;

export function readShapefiles(archive: Archive): GeoFileResult {
  const layers = new Map<string, Partial<Layer>>();
  for (const entry of archive.entries) {
    if (!["shp", "dbf", "prj", "cpg"].includes(entry.extension)) continue;
    const stem = entry.path.slice(0, entry.path.lastIndexOf("."));
    const key = stem.toLowerCase();
    const layer = layers.get(key) ?? { name: stem.slice(stem.lastIndexOf("/") + 1) };
    layer[entry.extension as "shp" | "dbf" | "prj" | "cpg"] ??= entry;
    layers.set(key, layer);
  }
  const found = Array.from(layers.values()).filter(
    (layer): layer is Layer => layer.shp !== undefined,
  );
  const collector = new Collector();
  if (found.length > LIMITS.layers)
    collector.note(
      `The archive has more than ${LIMITS.layers} layers. Only the first ${LIMITS.layers} were read.`,
    );
  let leftOut = 0;
  for (const layer of found.slice(0, LIMITS.layers)) {
    const shown = collector.label(layer.name, LIMITS.groupNameChars) ?? "layer";
    const said = `The layer "${shown}"`;
    const small = (entry: ArchiveEntry | undefined) => {
      if (!entry || entry.size > SMALL_TEXT_BYTES) return undefined;
      const data = archive.read([entry.name]).get(entry.name);
      return data ? decodeText(data, "latin-1") : undefined;
    };

    let transform = same;
    let strictRange = false;
    const wkt = small(layer.prj);
    const system = wkt === undefined ? undefined : classifyPrj(wkt);
    if (!system) strictRange = true;
    else if (system.kind === "web-mercator") {
      transform = fromWebMercator;
      collector.note(
        `${said} is in Web Mercator (EPSG:3857) and was converted to longitude and latitude.`,
      );
    } else if (system.kind === "geographic") {
      if (system.datum === "nad83")
        collector.note(
          `${said} is in NAD83. It was read as WGS84: the two are a metre or two apart.`,
        );
      else if (system.datum === "other")
        collector.note(
          `${said} is in the geographic system "${system.name}". It was read as WGS84: positions can be off by up to a few hundred metres.`,
        );
    } else {
      leftOut++;
      collector.note(
        system.kind === "projected"
          ? `${said} was left out: it is in the projection "${system.name}", which is not converted. Re-export it as WGS84 (EPSG:4326).`
          : `${said} was left out: its .prj file does not say a reference system that is read. Re-export it as WGS84 (EPSG:4326).`,
      );
      continue;
    }

    const shpBytes = archive.read([layer.shp.name]).get(layer.shp.name);
    if (!shpBytes) continue;
    let shapes: Shape[];
    try {
      shapes = readShp(
        shpBytes,
        `The .shp of "${shown}"`,
        transform,
        collector,
        strictRange,
      );
    } catch (cause) {
      if (!(cause instanceof LayerLeftOut)) throw cause;
      leftOut++;
      collector.note(
        cause.message === "multipatch"
          ? `${said} was left out: its shapes are of a kind (multipatch) the map does not draw.`
          : `${said} was left out: it has no .prj file and its positions are not longitudes and latitudes. Re-export it as WGS84 (EPSG:4326).`,
      );
      continue;
    }
    if (strictRange && shapes.length > 0)
      collector.note(
        `${said} has no .prj file. Its positions are longitudes and latitudes, so it was read as WGS84.`,
      );

    let table: DbfTable | undefined;
    let encoding: TextEncoding = "latin-1";
    let assumed = false;
    const dbfBytes = layer.dbf && archive.read([layer.dbf.name]).get(layer.dbf.name);
    if (dbfBytes) {
      table = readDbf(dbfBytes, `The .dbf of "${shown}"`);
      const named = small(layer.cpg)
        ?.trim()
        .split(/\s*[\r\n]/)[0];
      const fromName = named ? encodingNamed(named) : null;
      if (fromName) encoding = fromName;
      else if (named) {
        const code = named.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 24);
        collector.note(
          `The table of the layer "${shown}" says its text is in ${code || "an encoding"}, which is not read. It was read as Latin-1: letters with accents may be wrong.`,
        );
      } else if (Object.hasOwn(LANGUAGE_DRIVERS, table.languageDriver))
        encoding = LANGUAGE_DRIVERS[table.languageDriver];
      else assumed = true;
    } else collector.note(`${said} has no .dbf table: its shapes have no properties.`);

    const group = collector.group(layer.name);
    for (const shape of shapes)
      collector.add({
        geometry: shape.geometry,
        properties: table?.row(shape.row, encoding) ?? undefined,
        group,
        nameFromProperties: true,
      });
    if (assumed && table?.beyondAscii)
      collector.note(
        `The table of the layer "${shown}" does not say what its text is in (it has no .cpg file). It was read as Latin-1: letters with accents may be wrong.`,
      );
  }
  if (collector.features.length === 0 && leftOut > 0) {
    const { notes } = collector.finish("shapefile");
    return failFile("unsupported-projection", notes.join(" "));
  }
  return collector.finish("shapefile");
}
