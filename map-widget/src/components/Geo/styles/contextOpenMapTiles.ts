import {
  AREA,
  byKind,
  type ContextColors,
  type ContextParts,
  dot,
  extrusion,
  flat,
  kindIn,
  LINE,
  nameOf,
  railWidth,
  runwayWidth,
  taxiwayWidth,
  tint,
} from "./contextShared";

export const openMapTilesContext = (c: ContextColors): ContextParts => ({
  buildings: [
    {
      slot: "detail",
      from: "building",
      type: "fill",
      paint: { "fill-color": c.building, "fill-outline-color": c.buildingLine },
    },
  ],
  "buildings-3d": [
    {
      slot: "detail",
      from: "building",
      type: "fill-extrusion",
      filter: ["!=", ["get", "hide_3d"], true],
      paint: extrusion(c, "render_height", "render_min_height"),
    },
  ],
  landuse: [
    {
      slot: "cover",
      from: "landuse",
      type: "fill",
      filter: kindIn("class", [
        "residential",
        "suburb",
        "neighbourhood",
        "commercial",
        "retail",
        "industrial",
      ]),
      paint: {
        "fill-color": byKind(
          "class",
          [
            [["commercial", "retail"], c.commercial],
            [["industrial"], c.industrial],
          ],
          c.residential,
        ),
        "fill-opacity": tint(4),
      },
    },
    {
      slot: "cover",
      from: "landcover",
      name: "farmland",
      type: "fill",
      filter: ["==", ["get", "class"], "farmland"],
      paint: { "fill-color": c.farmland, "fill-opacity": tint(4) },
    },
  ],
  green: [
    {
      slot: "cover",
      from: "landcover",
      name: "cover",
      type: "fill",
      filter: kindIn("class", ["wood", "grass"]),
      paint: {
        "fill-color": byKind("class", [[["wood"], c.wood]], c.grass),
        "fill-opacity": tint(4),
      },
    },
    {
      slot: "land",
      from: "park",
      type: "fill",
      filter: AREA,
      paint: { "fill-color": c.park, "fill-opacity": tint(4) },
    },
  ],
  railways: [
    {
      slot: "detail",
      from: "transportation",
      type: "line",
      filter: [
        "all",
        LINE,
        ["==", ["get", "class"], "rail"],
        ["!=", ["get", "brunnel"], "tunnel"],
      ],
      layout: flat,
      paint: { "line-color": c.rail, "line-width": railWidth },
    },
  ],
  airports: [
    {
      slot: "cover",
      from: "aeroway",
      type: "fill",
      filter: AREA,
      paint: {
        "fill-color": byKind(
          "class",
          [[["runway", "taxiway", "apron"], c.runway]],
          c.airport,
        ),
      },
    },
    {
      slot: "detail",
      from: "aeroway",
      name: "taxiway",
      type: "line",
      filter: ["all", LINE, ["==", ["get", "class"], "taxiway"]],
      minzoom: 12,
      layout: flat,
      paint: { "line-color": c.runway, "line-width": taxiwayWidth },
    },
    {
      slot: "detail",
      from: "aeroway",
      name: "runway",
      type: "line",
      filter: ["all", LINE, ["==", ["get", "class"], "runway"]],
      layout: flat,
      paint: { "line-color": c.runway, "line-width": runwayWidth },
    },
  ],
  pois: [
    {
      slot: "detail",
      from: "poi",
      type: "circle",
      filter: ["<=", ["to-number", ["get", "rank"], 99], 12],
      paint: dot(c),
    },
    {
      slot: "detail",
      from: "poi",
      name: "more",
      type: "circle",
      filter: [">", ["to-number", ["get", "rank"], 99], 12],
      minzoom: 16,
      paint: dot(c),
    },
    {
      slot: "names",
      from: "poi",
      name: "names",
      type: "symbol",
      filter: ["any", ["has", "name_en"], ["has", "name:latin"]],
      minzoom: 15,
      ...nameOf(c, ["coalesce", ["get", "name_en"], ["get", "name:latin"], ""]),
    },
  ],
});
