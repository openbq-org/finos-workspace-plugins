# Boundary files for maps

These are the shapes the map draws without asking any server: the land and the borders of the basemap that a map draws when no tiles can be read, and the regions that data can shade. They are copied or built here so that a map never depends on a CDN or a registry at run time. The plugin reads each file from its package (`assets/geo/`) with `core:asset:read`, only when a map needs it; none is part of what the plugin loads at its start.

There are two kinds of files:

- **Unmodified files of two npm packages** (`us-atlas-3.0.1/`, `world-atlas-2.0.2/`): the US states and counties, and the world at 1:110m, which is the land of the fallback basemap.
- **Files built by a script of this repository** (`regions/`): the countries at 1:50m, the first-level regions of the world, the US metro areas and congressional districts, and one index for each boundary set. [`scripts/geo/prepare-regions.mjs`](../../scripts/geo/prepare-regions.mjs) builds them from public-domain sources.

## The files

Sizes are in bytes; "gzip" is what a server that compresses sends.

| File | Regions | Source of the shapes | Raw | Gzip |
| --- | --- | --- | --- | --- |
| `us-atlas-3.0.1/states-10m.json` | 56 | [`us-atlas@3.0.1`](https://github.com/topojson/us-atlas): US Census Bureau cartographic boundary files, 2017, 1:10m | 114,554 | 36,094 |
| `us-atlas-3.0.1/counties-10m.json` | 3,231 | the same | 842,143 | 250,234 |
| `world-atlas-2.0.2/countries-110m.json` | 177 | [`world-atlas@2.0.2`](https://github.com/topojson/world-atlas): Natural Earth 4.1.0, Admin 0, 1:110m | 107,761 | 38,423 |
| `regions/countries-50m.json` | 239 | Natural Earth 5.1.1, Admin 0 countries, 1:50m | 645,565 | 220,183 |
| `regions/admin1-africa.json` | 898 | Natural Earth 5.1.1, Admin 1 states and provinces, 1:10m, simplified | 576,803 | 175,986 |
| `regions/admin1-asia.json` | 1,050 | the same | 954,794 | 288,390 |
| `regions/admin1-europe.json` | 1,606 and 56 groups | the same | 1,088,724 | 327,067 |
| `regions/admin1-north-america.json` | 396 | the same | 692,392 | 213,899 |
| `regions/admin1-south-america.json` | 241 | the same | 343,534 | 105,778 |
| `regions/admin1-oceania.json` | 121 | the same | 150,942 | 46,204 |
| `regions/us-cbsa.json` | 935 | US Census Bureau cartographic boundary file 2024, CBSA, 1:5m, simplified | 584,623 | 196,849 |
| `regions/us-cd119.json` | 441 | US Census Bureau cartographic boundary file 2024, 119th Congress, 1:5m, simplified | 617,363 | 206,561 |
| `regions/us-states.index.json` | 56 | index of `states-10m.json` | 4,354 | 2,202 |
| `regions/us-counties.index.json` | 3,231 | index of `counties-10m.json` | 220,674 | 81,466 |
| `regions/countries.index.json` | 240 | index of `countries-50m.json` | 27,197 | 11,769 |
| `regions/admin1.index.json` | 4,368 | index of the six `admin1-*.json` | 481,209 | 175,836 |
| `regions/us-cbsa.index.json` | 935 | index of `us-cbsa.json` | 84,553 | 33,177 |
| `regions/us-cd119.index.json` | 441 | index of `us-cd119.json` | 41,569 | 14,561 |

Together 7.58 MB, 2.42 MB compressed. The largest file is 1.09 MB (327 KB compressed). With the cities below the folder is 8,700,643 bytes: 8,497 KB of the 8,704 KB a test lets it hold (every file under 1.5 MB, the folder under 8.5 MB of 1,024 KB each; it was 8 MB until the cities got their regions and their other names, which added 410 KB to that one file).

## The cities

| File | Cities | Source | Raw | Gzip |
| --- | --- | --- | --- | --- |
| `places/cities.json` | 23,162 of 244 countries and territories | GeoNames `cities15000`: every place of 25,000 residents or more, and every capital of a country or of a first-level region; 568 names in English from Natural Earth 5.1.1 populated places; the first-level region of 22,975 of them, from the boundary set of this folder; 25,034 other names of the 3,785 cities of 150,000 residents or more | 1,121,889 | 478,308 |

It is what a map places by the name of a city ([`src/lib/geo/regions/cities.ts`](../../src/lib/geo/regions/cities.ts)): no shapes, one row for each city (its name, its place to a thousandth of a degree, its residents to the thousand, the first-level region it is in, and the names people write in English), and beside the rows every other name of a large city. The app fetches it the first time a map names a city.

**Licence.** GeoNames is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([LICENSE.geonames](LICENSE.geonames)): a map that places a point by a city shows "Cities: GeoNames, CC BY 4.0" in its credit area and writes the credit into every file it is exported to. Natural Earth is in the public domain.

**Why GeoNames and not Natural Earth alone.** Natural Earth's populated places (7,342, public domain) would need no credit, but they are the places a world map labels, not the places firms are in: of 104 business locations that were checked, 24 are missing (Greenwich, Menlo Park, Palo Alto, Mountain View, Jersey City, Redmond, Cupertino, Plano, Princeton, Santa Monica, Bellevue, Waltham among them). GeoNames has them. All 34,151 places of `cities15000` are 1.04 MB in this form, which the folder has no room for; 25,000 residents keeps 23,162 in 0.71 MB. A place under that size is not matched (Armonk, Purchase, and Greenwich in Connecticut, which GeoNames lists as a town and not as a populated place): the map says which rows it could not place, and they take a latitude and a longitude.

**The names.** GeoNames lists a city under one name, often the local one ("Genève", "Kraków", "Bengaluru"), and its other names in every language in one list. The names people write in English come from Natural Earth: each of its places gives its names to the largest city of GeoNames of the same country within 25 km, and a name is kept only when GeoNames lists it for that city too. Eight former names (Calcutta, Bombay, Madras, Gurgaon, Saigon, Peking, Canton, Rangoon) are a list of the script, checked the same way: without them "Calcutta" is only a town in South Africa.

**The region of a city.** GeoNames names the first-level region of a city by a code of its own (a number in most countries), which the boundary set does not have. The script finds the region on the map: the region of `regions/admin1-*.json` whose shape holds the city, or the nearest within 0.3 degrees for a city on a coast the simplified shape leaves outside. It is written as the end of its ISO 3166-2 code (`ON`, `BY`), the province and the region above it where the set has two levels (`MI/25`). 187 cities are in no region of the set (Hong Kong, Puerto Rico, Kosovo, Somaliland). A city of the United States keeps the state GeoNames gives. With it "Toronto, ON", "Sydney, NSW" and a `state` column beside Canada narrow a city by the index of the first-level regions.

**Every other name of a large city.** "München", "Genève", "Roma", "Firenze", "Bruxelles" and "Den Haag" matched nothing. GeoNames lists the names of a city in every language in one list and does not say which language each is in, so no name can be chosen: a city of 150,000 residents or more has all of them that are written in Latin letters and start with a capital (the others are transliterations letter by letter), each once by its key. All cities would be 1.9 MB of names; from 150,000 residents it is 297 KB. The matcher asks them only when no city has the name as its own, and the map says which cities it placed by another name.

**Sources**, downloaded on 2026-10-10:

| Archive | Address | SHA-256 of the archive |
| --- | --- | --- |
| `cities15000.zip` (GeoNames) | `https://download.geonames.org/export/dump/cities15000.zip` | `9339ac426943c265eb7fdfd5350ae351a5584b4d4271ed58f071ddc432982aeb` |
| `ne_10m_populated_places_simple.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip` | `2963ee08f7743f13f37d5243acd77a2f7a510e26a36c7e04b920f1b381f2b251` |

To reproduce, with node 22.18 or later and `unzip` (the script downloads nothing and runs nothing of an archive: it reads one file of data from each):

```
mkdir -p dl && cd dl
for u in <the two addresses>; do n=$(basename $u .zip); mkdir -p $n; curl -sSL -o $n/$n.zip $u; done
cd .. && node scripts/geo/prepare-cities.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

GeoNames publishes `cities15000.zip` anew every day, so an archive of another day has another SHA-256 and the script stops: record the new one in the script and here, and review what changed in `cities.json`.

## The ZIP codes

| File | Rows | Source | Bytes | Compressed |
| --- | --- | --- | --- | --- |
| `places/zips.json` | 33,791 US ZIP codes | The ZIP Code Tabulation Areas of the national Gazetteer file of the US Census Bureau, 2025 edition (the areas of the 2020 Census) | 205,557 | 136,360 |

It is where a map puts a row that names a US ZIP code ([`src/lib/geo/regions/zips.ts`](../../src/lib/geo/regions/zips.ts)): no shapes, one place for each code, the internal point of its area as the Gazetteer gives it (`INTPTLAT`, `INTPTLONG`) to a thousandth of a degree, about 110 m. With it the folder is 8,906,200 bytes of the 8,912,896 a test lets it hold.

**Licence.** A work of the United States government, in the public domain: no credit is asked for.

**A ZCTA is not a ZIP code.** A ZIP Code Tabulation Area is the area the Census Bureau builds from census blocks for the ZIP code of the same five digits. It approximates the delivery area of that ZIP code and is not identical to it, and a ZIP code that is only a post office box or one large building has none. The areas are those of the 2020 Census.

**The form.** `{ source, vintage, licence, scale, count, table }`, where `table` is base64 of bytes: for each code in ascending order, the difference of the code, of the latitude times `scale` and of the longitude times `scale` from the ones before, as variable-length integers of seven bits a byte (the last two signed: 2n, or -2n - 1 below zero). ZIP codes that are near in number are near on the ground, so the differences are small: a list of the same numbers as text was 354 KB.

**Source**, downloaded on 2026-10-11:

| Archive | Address | SHA-256 of the archive |
| --- | --- | --- |
| `2025_Gaz_zcta_national.zip` (US Census Bureau) | `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip` | `51516a4283bab5cd2376eec75609ddc4b363a18297e8adeeaac7b03cf7c84dbe` |

To reproduce, with node 22.18 or later and `unzip` (the script downloads nothing and runs nothing of the archive: it reads its one file of text):

```
mkdir -p dl/2025_Gaz_zcta_national && curl -sSL -o dl/2025_Gaz_zcta_national/2025_Gaz_zcta_national.zip <the address>
node scripts/geo/prepare-zips.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

A shape file is TopoJSON in decimal degrees, not projected. Each shape has an id: the FIPS code of a state (two digits) or a county (five), the ISO 3166-1 numeric code of a country, the ISO 3166-2 code of a first-level region (`CA-ON`), the CBSA code of a metro area (five digits), the postal code of the state and the number of a district (`CA-12`, `AK-AL`). An index file has no shapes: for each region its id, its names, a point inside its largest part and its box. The app matches data against the index ([`src/lib/geo/regions/registry.ts`](../../src/lib/geo/regions/registry.ts)) and loads shapes only for a map.

## Provenance

**The npm packages.** The three files were taken from the npm tarballs, whose SHA-256 are:

```
e6daba1800885868303ad3549da62f85a557b8142bb72629ec15651de62f9c5d  us-atlas-3.0.1.tgz
032e7765f2ce00edaeafec23ff22bc3b77e42987c257da944cc585b452c05b97  world-atlas-2.0.2.tgz
```

To reproduce: `npm pack us-atlas@3.0.1 world-atlas@2.0.2`, unpack, and copy the three files.

**The sources of `regions/`.** Downloaded on 2026-10-09:

| Archive | Address | SHA-256 of the archive |
| --- | --- | --- |
| `ne_50m_admin_0_countries.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip` | `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139` |
| `ne_10m_admin_1_states_provinces.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip` | `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05` |
| `cb_2024_us_cbsa_5m.zip` | `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cbsa_5m.zip` | `94b5bdbb8990eabb66e9c1450731858607e2c02489bcf669f546aa477b9caca8` |
| `cb_2024_us_cd119_5m.zip` | `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_5m.zip` | `17370f9f4070f3a0fa82bb7400042bd418be77c208abc44288b52b3ad2344cc6` |

To reproduce, with the node of `.nvmrc` and network access for `npx` (it fetches `mapshaper@0.6.102`, the one tool the script runs):

```
mkdir -p dl && cd dl
for u in <the four addresses>; do n=$(basename $u .zip); mkdir -p $n; curl -sSL -o $n/$n.zip $u; done
cd .. && node scripts/geo/prepare-regions.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

The script stops when an archive does not have the SHA-256 above, writes the same bytes on each run, and fails when two lines of a file cross. It also reads the two files of `us-atlas-3.0.1/` (for the indexes of the states and the counties) and the table of ISO 3166-1 codes in [`scripts/geo/tables.mjs`](../../scripts/geo/tables.mjs), which is the input of the script only: the app matches with the index files it writes.

The SHA-256 of each file here is in [SHA256SUMS](SHA256SUMS); a unit test checks the list ([`vendorChecksums.test.ts`](../../tests/unit/lib/geo/vendorChecksums.test.ts)) and the image build checks it again, so a file that changes without its line fails both. Update the list in the same commit as a file.

## What the script does to the shapes

| Set | Positions in the source | Positions shipped | Detail kept | Grid |
| --- | --- | --- | --- | --- |
| Countries | 80,683 | 62,220 | bends over 2 km | 0.001 degree (about 100 m) |
| First-level regions | 864,294 | 357,949 | bends over 1 km | 0.001 degree |
| Metro and micro areas | 71,993 | 47,812 | bends over 400 m | 0.0002 degree (about 20 m) |
| Congressional districts | 105,423 | 58,228 | bends over 400 m | 0.0002 degree |

- **Shared borders stay shared.** The simplification works on the lines between regions, each stored once, so two neighbours keep one border with no gap and no overlap. Every region is kept, however small.
- **One grid for the world.** Positions are whole steps from -180, -90, the same for every file. The six continent files of the first-level regions are cut from one simplified topology, so the border between two of them (Russia and Kazakhstan) has the same positions in both files.
- **Checked by numbers.** After the grid, the script counts the pairs of segments that cross: zero for every file. Tests repeat the count on the shipped files, and check that the point of each region is inside its shape and its box.
- **The index.** The point of a region is the middle of the widest stretch of its largest part, so it is inside also for a crescent or a shape with a hole. The box of a region that crosses the 180th meridian (Alaska, Chukotka, Fiji) is measured across it: west can be under -180 or east over 180. A country or a region whose parts are far apart (France with its overseas departments) also has the box of its largest part, which is what a map opens on.

## Deliberate choices about codes

- **Natural Earth has `-99` for the ISO codes of France and Norway.** Their ids are 250 and 578, from the fields that carry the corrected codes.
- **Kosovo, Northern Cyprus and Somaliland have no ISO 3166-1 numeric code.** Their ids are the three letters Natural Earth uses (`XKX`, `CYN`, `SOL`), which cannot be taken for a numeric code. Kosovo also answers to `XK`.
- **Western Sahara (732), Taiwan (158), Palestine (275), Puerto Rico (630), Greenland (304), Hong Kong (344) and Macao (446)** are regions of their own, as in ISO 3166-1. The app takes no position: it draws what the source draws.
- **The Indian Ocean Territories and the Ashmore and Cartier Islands** are part of the shape of Australia (036). **The Siachen Glacier** has no id and is left out.
- **First-level regions follow ISO 3166-2 as Natural Earth records it**, with these corrections: seven codes that ISO changed since (`MX-DIF` is `MX-CMX`, `IN-OR` is `IN-OD`, and so on; the old code still matches), seven shapes that were filed under the code of a neighbour, and shapes that share one code are one region (Dublin of its four councils, Metro Manila of its 17 cities).
- **France, Italy, Spain, Belgium and the United Kingdom are drawn by Natural Earth one level down** (departments, provinces, counties). The file has those, and the level above as groups made of them: the 13 regions of metropolitan France, the 20 regions of Italy, the 17 communities of Spain, Flanders and Wallonia, England, Scotland, Wales and Northern Ireland.
- **188 shapes of the source have no ISO 3166-2 code and are left out**: the municipalities of Kosovo, the districts of Hong Kong, and small territories that are a country of their own in the countries file (Gibraltar, Monaco, Aruba, Guam).
- **Congressional districts.** The one district of a state and the seat of a delegate (the District of Columbia and five territories) have the id `<state>-AL`. The source writes them 00 and 98.

## Licences

The data of the US Census Bureau and of Natural Earth is in the public domain. The packaging of the two npm packages as TopoJSON is under the ISC licence of each: see [LICENSE.us-atlas](LICENSE.us-atlas) and [LICENSE.world-atlas](LICENSE.world-atlas). The files of `regions/` are built by this repository from the public-domain sources directly.

## What is not here

- **ZIP code areas, census tracts and second-level regions of the world.** They are too many to ship (about 33,000 ZIP code areas, 85,000 tracts). A backend serves their shapes as a vector source whose features carry the id, and data joins by that id.
- **The counties are those of 2017.** Connecticut replaced its eight counties with nine planning regions in 2022, and data of the Census Bureau from 2022 on uses the new codes (09110 to 09190), which have no shape here.
- **Metro divisions and combined statistical areas.** Only metro and micro areas (CBSA).
- The Albers USA files of `us-atlas` are not used: the map draws in Web Mercator.
