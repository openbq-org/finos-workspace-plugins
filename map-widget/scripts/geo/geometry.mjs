
export function arcPoints(topology, index) {
  const arc = topology.arcs[index < 0 ? ~index : index];
  const transform = topology.transform;
  let points = arc;
  if (transform) {
    let x = 0;
    let y = 0;
    points = arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [
        x * transform.scale[0] + transform.translate[0],
        y * transform.scale[1] + transform.translate[1],
      ];
    });
  }
  return index < 0 ? [...points].reverse() : points;
}

export function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.arcs];
  if (geometry.type === "MultiPolygon") return geometry.arcs;
  return [];
}

export function ringPoints(topology, ring) {
  const points = [];
  for (const index of ring) {
    const part = arcPoints(topology, index);
    for (let i = points.length ? 1 : 0; i < part.length; i++) points.push(part[i]);
  }
  return points;
}

export function ringArea2(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++)
    sum += (points[j][0] - points[i][0]) * (points[j][1] + points[i][1]);
  return sum;
}

export function inPolygon([x, y], rings) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  return inside;
}

export function inGeometry(point, geometry) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some((rings) => inPolygon(point, rings));
}

function stretches(rings, y) {
  const xs = [];
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
  xs.sort((a, b) => a - b);
  const found = [];
  for (let i = 0; i + 1 < xs.length; i += 2) found.push([xs[i], xs[i + 1]]);
  return found;
}

export function labelPoint(geometry) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  let largest = null;
  let size = 0;
  for (const rings of polygons) {
    const lats = rings[0].map((point) => point[1]);
    const middle = (Math.min(...lats) + Math.max(...lats)) / 2;
    const area =
      Math.abs(ringArea2(rings[0])) * Math.max(0.01, Math.cos((middle * Math.PI) / 180));
    if (area > size) {
      size = area;
      largest = rings;
    }
  }
  if (!largest) return null;
  const outer = largest[0];
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let cx = 0;
  let cy = 0;
  let twice = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    twice += cross;
    cx += (outer[j][0] + outer[i][0]) * cross;
    cy += (outer[j][1] + outer[i][1]) * cross;
    south = Math.min(south, outer[i][1]);
    north = Math.max(north, outer[i][1]);
  }
  const centre = twice ? [cx / (3 * twice), cy / (3 * twice)] : null;
  const height = north - south;
  const lats = [0.5, 0.35, 0.65, 0.2, 0.8].map((share) => south + height * share);
  if (centre && centre[1] > south && centre[1] < north) lats.unshift(centre[1]);
  let best = null;
  for (const lat of lats)
    for (const [west, east] of stretches(largest, lat)) {
      const width = (east - west) * (lat === lats[0] ? 1.5 : 1);
      if (!best || width > best.width)
        best = { width, at: [(west + east) / 2, lat] };
    }
  return best ? best.at : null;
}

export function boxOf(geometry) {
  const lons = [];
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const visit = (value) => {
    if (typeof value[0] === "number") {
      lons.push(value[0]);
      south = Math.min(south, value[1]);
      north = Math.max(north, value[1]);
    } else for (const item of value) visit(item);
  };
  if (geometry.coordinates) visit(geometry.coordinates);
  if (!lons.length) return null;
  const span = (shift) => {
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    for (const lon of lons) {
      const moved = shift > 0 && lon < 0 ? lon + 360 : shift < 0 && lon > 0 ? lon - 360 : lon;
      west = Math.min(west, moved);
      east = Math.max(east, moved);
    }
    return [west, east];
  };
  const readings = [span(0), span(-1), span(1)];
  let [west, east] = readings[0];
  for (const [w, e] of readings.slice(1)) {
    const narrower = e - w < east - west - 1e-9;
    const same = Math.abs(e - w - (east - west)) < 1e-9;
    const inRange = Math.abs((w + e) / 2) <= 180 && Math.abs((west + east) / 2) > 180;
    if (narrower || (same && inRange)) [west, east] = [w, e];
  }
  return [west, south, east, north];
}

export function prune(topology, objects) {
  const renumbered = new Map();
  const arcs = [];
  const moved = (index) => {
    const at = index < 0 ? ~index : index;
    if (!renumbered.has(at)) {
      renumbered.set(at, arcs.length);
      arcs.push(topology.arcs[at]);
    }
    const to = renumbered.get(at);
    return index < 0 ? ~to : to;
  };
  const walk = (value) => (Array.isArray(value) ? value.map(walk) : moved(value));
  const out = {};
  for (const [name, geometries] of Object.entries(objects))
    out[name] = {
      type: "GeometryCollection",
      geometries: geometries.map((geometry) => ({ ...geometry, arcs: walk(geometry.arcs) })),
    };
  return { type: "Topology", arcs, objects: out };
}

export function quantize(topology, step) {
  const arcs = topology.arcs.map((arc) => {
    const out = [];
    let px = 0;
    let py = 0;
    for (const [lon, lat] of arc) {
      const x = Math.round((lon + 180) / step);
      const y = Math.round((lat + 90) / step);
      if (out.length && x === px && y === py) continue;
      out.push([x - px, y - py]);
      px = x;
      py = y;
    }
    if (out.length === 1) out.push([0, 0]);
    return out;
  });
  return { ...topology, arcs, transform: { scale: [step, step], translate: [-180, -90] } };
}

function gridArcs(topology) {
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x, y];
    });
  });
}

const turn = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

export function crossings(topology, cell = 64) {
  const arcs = gridArcs(topology);
  const cells = new Map();
  const segments = [];
  arcs.forEach((arc, arcIndex) => {
    for (let i = 0; i + 1 < arc.length; i++) {
      const a = arc[i];
      const b = arc[i + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const id = segments.length;
      segments.push([a, b, arcIndex, i]);
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
      const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
      const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          if ((x1 - x0) * (y1 - y0) > 16 && !touches(a, b, cx * cell, cy * cell, cell))
            continue;
          const key = cx * 100003 + cy;
          const list = cells.get(key);
          if (list) list.push(id);
          else cells.set(key, [id]);
        }
    }
  });
  const seen = new Set();
  let count = 0;
  for (const list of cells.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = segments[list[i]];
        const [c, d] = segments[list[j]];
        const d1 = turn(a, b, c);
        const d2 = turn(a, b, d);
        const d3 = turn(c, d, a);
        const d4 = turn(c, d, b);
        if (d1 * d2 < 0 && d3 * d4 < 0) {
          const key = list[i] * segments.length + list[j];
          if (!seen.has(key)) {
            seen.add(key);
            count++;
          }
        }
      }
  return count;
}

function touches(a, b, x, y, cell) {
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const along = Math.max(
    0,
    Math.min(1, ((cx - a[0]) * dx + (cy - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(a[0] + along * dx - cx, a[1] + along * dy - cy) <= cell;
}

export function measure(topology, objectName) {
  const uses = new Map();
  const count = (value) => {
    if (Array.isArray(value)) for (const item of value) count(item);
    else {
      const at = value < 0 ? ~value : value;
      uses.set(at, (uses.get(at) ?? 0) + 1);
    }
  };
  const geometries = topology.objects[objectName]?.geometries ?? [];
  for (const geometry of geometries) if (geometry.arcs) count(geometry.arcs);
  let shared = 0;
  for (const times of uses.values()) if (times > 1) shared++;
  return {
    regions: geometries.length,
    arcs: topology.arcs.length,
    sharedArcs: shared,
    positions: topology.arcs.reduce((total, arc) => total + arc.length, 0),
  };
}
