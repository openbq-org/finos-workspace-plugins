import {
  byKind,
  type ContextColors,
  type ContextParts,
  dot,
  extrusion,
  flat,
  kindIn,
  nameOf,
  railWidth,
  runwayWidth,
  taxiwayWidth,
  tint,
} from "./contextShared";

export const protomapsContext = (c: ContextColors): ContextParts => {
  const buildings = kindIn("kind", ["building", "building_part"]);
  return {
    buildings: [
      {
        slot: "detail",
        from: "buildings",
        type: "fill",
        filter: buildings,
        paint: { "fill-color": c.building, "fill-outline-color": c.buildingLine },
      },
    ],
    "buildings-3d": [
      {
        slot: "detail",
        from: "buildings",
        type: "fill-extrusion",
        filter: buildings,
        paint: extrusion(c, "height", "min_height"),
      },
    ],
    landuse: [
      {
        slot: "land",
        from: "landcover",
        name: "cover",
        type: "fill",
        filter: kindIn("kind", ["urban_area", "farmland"]),
        maxzoom: 8,
        paint: {
          "fill-color": byKind("kind", [[["urban_area"], c.residential]], c.farmland),
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 7.5, 0],
        },
      },
      {
        slot: "land",
        from: "landuse",
        type: "fill",
        filter: kindIn("kind", [
          "residential",
          "commercial",
          "retail",
          "industrial",
          "farmland",
          "farmyard",
          "orchard",
        ]),
        minzoom: 3,
        paint: {
          "fill-color": byKind(
            "kind",
            [
              [["commercial", "retail"], c.commercial],
              [["industrial"], c.industrial],
              [["farmland", "farmyard", "orchard"], c.farmland],
            ],
            c.residential,
          ),
          "fill-opacity": tint(3),
        },
      },
    ],
    green: [
      {
        slot: "land",
        from: "landcover",
        name: "cover",
        type: "fill",
        filter: kindIn("kind", ["forest"]),
        maxzoom: 8,
        paint: {
          "fill-color": c.wood,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 7.5, 0],
        },
      },
      {
        slot: "land",
        from: "landuse",
        type: "fill",
        filter: kindIn("kind", [
          "park",
          "national_park",
          "nature_reserve",
          "protected_area",
          "forest",
          "wood",
          "grass",
          "grassland",
          "meadow",
          "garden",
          "golf_course",
          "recreation_ground",
          "village_green",
        ]),
        paint: {
          "fill-color": byKind(
            "kind",
            [
              [["forest", "wood"], c.wood],
              [["grass", "grassland", "meadow"], c.grass],
            ],
            c.park,
          ),
          "fill-opacity": tint(2),
        },
      },
    ],
    railways: [
      {
        slot: "detail",
        from: "roads",
        type: "line",
        filter: ["==", ["get", "kind"], "rail"],
        layout: flat,
        paint: { "line-color": c.rail, "line-width": railWidth },
      },
    ],
    airports: [
      {
        slot: "land",
        from: "landuse",
        type: "fill",
        filter: kindIn("kind", ["aerodrome", "airfield"]),
        paint: { "fill-color": c.airport },
      },
      {
        slot: "land",
        from: "landuse",
        name: "apron",
        type: "fill",
        filter: kindIn("kind", ["runway", "taxiway"]),
        paint: { "fill-color": c.runway },
      },
      {
        slot: "detail",
        from: "roads",
        name: "taxiway",
        type: "line",
        filter: ["==", ["get", "kind_detail"], "taxiway"],
        minzoom: 12,
        layout: flat,
        paint: { "line-color": c.runway, "line-width": taxiwayWidth },
      },
      {
        slot: "detail",
        from: "roads",
        name: "runway",
        type: "line",
        filter: ["==", ["get", "kind_detail"], "runway"],
        minzoom: 10,
        layout: flat,
        paint: { "line-color": c.runway, "line-width": runwayWidth },
      },
    ],
    pois: [
      {
        slot: "detail",
        from: "pois",
        type: "circle",
        filter: ["<=", ["to-number", ["get", "min_zoom"], 16], 14],
        paint: dot(c),
      },
      {
        slot: "detail",
        from: "pois",
        name: "more",
        type: "circle",
        filter: [">", ["to-number", ["get", "min_zoom"], 16], 14],
        minzoom: 15,
        paint: dot(c),
      },
      {
        slot: "names",
        from: "pois",
        name: "names",
        type: "symbol",
        filter: ["has", "name"],
        minzoom: 15,
        ...nameOf(c, ["coalesce", ["get", "name:en"], ["get", "name"], ""]),
      },
    ],
  };
};
