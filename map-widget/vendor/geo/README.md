# Boundary files

Shapes and places the map reads from its package (`assets/geo/`, `core:asset:read`) when a map needs them.

- `us-atlas-3.0.1/`, `world-atlas-2.0.2/`: unmodified files of two npm packages. `countries-110m.json` is the land of the fallback basemap.
- `regions/`: built by [`scripts/geo/prepare-regions.mjs`](../../scripts/geo/prepare-regions.mjs) from public-domain sources.
- `places/`: built by [`scripts/geo/prepare-cities.mjs`](../../scripts/geo/prepare-cities.mjs) and [`scripts/geo/prepare-zips.mjs`](../../scripts/geo/prepare-zips.mjs).

## Shapes

Sizes in bytes.

| File | Regions | Source | Raw | Gzip |
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

Shapes total 7.58 MB (2.42 MB gzip). With `places/` the folder is 8,906,200 bytes. [`vendorChecksums.test.ts`](../../tests/unit/lib/geo/vendorChecksums.test.ts) caps each file at 1.5 MiB and the folder at 8.5 MiB.

A shape file is TopoJSON in decimal degrees, not projected. Shape ids:

| Set | Id |
| --- | --- |
| US states | FIPS code, two digits |
| US counties | FIPS code, five digits |
| Countries | ISO 3166-1 numeric code |
| First-level regions | ISO 3166-2 code (`CA-ON`) |
| Metro areas | CBSA code, five digits |
| Congressional districts | state postal code and district number (`CA-12`, `AK-AL`) |

An index file has no shapes: per region its id, names, a point inside its largest part, and its box. Data is matched against the index ([`src/lib/geo/regions/registry.ts`](../../src/lib/geo/regions/registry.ts)); shapes are loaded only to draw.

## Cities

| File | Cities | Source | Raw | Gzip |
| --- | --- | --- | --- | --- |
| `places/cities.json` | 23,162 in 244 countries and territories | GeoNames `cities15000`: places of 25,000 residents or more and capitals of countries and first-level regions; 568 English names from Natural Earth 5.1.1 populated places; the first-level region of 22,975 cities from `regions/`; 25,034 alternate names of the 3,785 cities of 150,000 residents or more | 1,121,889 | 478,308 |

Read by [`src/lib/geo/regions/cities.ts`](../../src/lib/geo/regions/cities.ts) the first time a map names a city.

- **Row:** name, position to 0.001 degree, residents to the thousand, first-level region, English names. No shapes.
- **English names:** each Natural Earth place gives its names to the largest GeoNames city of the same country within 25 km, kept only when GeoNames lists the name for that city. The script adds eight former names: Calcutta, Bombay, Madras, Gurgaon, Saigon, Peking, Canton, Rangoon.
- **Region:** the `regions/admin1-*.json` region whose shape holds the city, or the nearest within 0.3 degrees. Written as the end of its ISO 3166-2 code (`ON`, `BY`), or province and region where the set has two levels (`MI/25`). US cities keep the GeoNames state. 187 cities have no region (Hong Kong, Puerto Rico, Kosovo, Somaliland).
- **Alternate names:** cities of 150,000 residents or more carry every GeoNames alternate name in Latin letters that starts with a capital. They are matched only when no city has the name as its own; the map lists cities placed by an alternate name.
- **Not matched:** places under 25,000 residents. The map lists the rows it could not place.

Licence: GeoNames is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([LICENSE.geonames](LICENSE.geonames)). A map that places a point by city shows "Cities: GeoNames, CC BY 4.0" in its credits and writes the credit into every export. Natural Earth is public domain.

Sources, downloaded 2026-10-10:

| Archive | Address | SHA-256 |
| --- | --- | --- |
| `cities15000.zip` (GeoNames) | `https://download.geonames.org/export/dump/cities15000.zip` | `9339ac426943c265eb7fdfd5350ae351a5584b4d4271ed58f071ddc432982aeb` |
| `ne_10m_populated_places_simple.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places_simple.zip` | `2963ee08f7743f13f37d5243acd77a2f7a510e26a36c7e04b920f1b381f2b251` |

Rebuild with node 22.18 or later and `unzip`. The script downloads nothing and reads one data file from each archive.

```
mkdir -p dl && cd dl
for u in <the two addresses>; do n=$(basename $u .zip); mkdir -p $n; curl -sSL -o $n/$n.zip $u; done
cd .. && node scripts/geo/prepare-cities.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

GeoNames republishes `cities15000.zip` daily and the script stops on a different SHA-256. Record the new SHA-256 in the script and here, and review the changes to `cities.json`.

## ZIP codes

| File | Rows | Source | Raw | Gzip |
| --- | --- | --- | --- | --- |
| `places/zips.json` | 33,791 US ZIP codes | ZIP Code Tabulation Areas of the US Census Bureau national Gazetteer file, 2025 edition (2020 Census areas) | 205,557 | 136,360 |

Read by [`src/lib/geo/regions/zips.ts`](../../src/lib/geo/regions/zips.ts).

- **Row:** one position per code: the internal point of its area (`INTPTLAT`, `INTPTLONG`) to 0.001 degree (about 110 m). No shapes.
- **ZCTA:** the Census Bureau area built from census blocks for the ZIP code of the same five digits. It approximates the delivery area. A PO box or single-building ZIP code has none.
- **Format:** `{ source, vintage, licence, scale, count, table }`. `table` is base64 of, for each code in ascending order, the deltas of the code, latitude × `scale` and longitude × `scale` from the previous code, as 7-bit variable-length integers. The last two are zigzag signed (2n, or -2n - 1 below zero).

Licence: US government work, public domain.

Source, downloaded 2026-10-11:

| Archive | Address | SHA-256 |
| --- | --- | --- |
| `2025_Gaz_zcta_national.zip` (US Census Bureau) | `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip` | `51516a4283bab5cd2376eec75609ddc4b363a18297e8adeeaac7b03cf7c84dbe` |

Rebuild with node 22.18 or later and `unzip`. The script downloads nothing and reads the one text file of the archive.

```
mkdir -p dl/2025_Gaz_zcta_national && curl -sSL -o dl/2025_Gaz_zcta_national/2025_Gaz_zcta_national.zip <the address>
node scripts/geo/prepare-zips.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

## Provenance

npm tarballs:

```
e6daba1800885868303ad3549da62f85a557b8142bb72629ec15651de62f9c5d  us-atlas-3.0.1.tgz
032e7765f2ce00edaeafec23ff22bc3b77e42987c257da944cc585b452c05b97  world-atlas-2.0.2.tgz
```

Rebuild: `npm pack us-atlas@3.0.1 world-atlas@2.0.2`, unpack, copy the three files.

Sources of `regions/`, downloaded 2026-10-09:

| Archive | Address | SHA-256 |
| --- | --- | --- |
| `ne_50m_admin_0_countries.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip` | `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139` |
| `ne_10m_admin_1_states_provinces.zip` (Natural Earth 5.1.1) | `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip` | `efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05` |
| `cb_2024_us_cbsa_5m.zip` | `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cbsa_5m.zip` | `94b5bdbb8990eabb66e9c1450731858607e2c02489bcf669f546aa477b9caca8` |
| `cb_2024_us_cd119_5m.zip` | `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_5m.zip` | `17370f9f4070f3a0fa82bb7400042bd418be77c208abc44288b52b3ad2344cc6` |

Rebuild with the node of `.nvmrc` and network access for `npx` (it fetches `mapshaper@0.6.102`):

```
mkdir -p dl && cd dl
for u in <the four addresses>; do n=$(basename $u .zip); mkdir -p $n; curl -sSL -o $n/$n.zip $u; done
cd .. && node scripts/geo/prepare-regions.mjs --downloads dl
cd vendor/geo && sha256sum -c SHA256SUMS
```

- The script stops on an archive with a different SHA-256, writes the same bytes on every run, and fails when two lines of a file cross.
- It also reads `us-atlas-3.0.1/` (for the state and county indexes) and the ISO 3166-1 table in [`scripts/geo/tables.mjs`](../../scripts/geo/tables.mjs).

[SHA256SUMS](SHA256SUMS) lists every file. [`vendorChecksums.test.ts`](../../tests/unit/lib/geo/vendorChecksums.test.ts) and the image build check it. Update it in the same commit as the file.

## Simplification

| Set | Positions in the source | Positions shipped | Bends kept | Grid |
| --- | --- | --- | --- | --- |
| Countries | 80,683 | 62,220 | over 2 km | 0.001 degree (about 100 m) |
| First-level regions | 864,294 | 357,949 | over 1 km | 0.001 degree |
| Metro and micro areas | 71,993 | 47,812 | over 400 m | 0.0002 degree (about 20 m) |
| Congressional districts | 105,423 | 58,228 | over 400 m | 0.0002 degree |

- **Shared borders:** simplified once per border, so neighbours have no gap or overlap. Every region is kept.
- **Grid:** whole steps from -180, -90 in every file. The six `admin1-*` files are cut from one topology, so a border between two of them has the same positions in both.
- **Checks:** zero crossing segment pairs in every file. Tests repeat the count on the shipped files and check each region's point is inside its shape and box.
- **Index point:** the middle of the widest stretch of the largest part, inside for crescents and shapes with holes.
- **Index box:** measured across the 180th meridian for regions that cross it (Alaska, Chukotka, Fiji), so west can be under -180 or east over 180. A country with distant parts (France) also has the box of its largest part.

## Codes

- **France and Norway:** Natural Earth has `-99` as their ISO code; their ids are 250 and 578.
- **Kosovo, Northern Cyprus, Somaliland:** no ISO 3166-1 numeric code; ids `XKX`, `CYN`, `SOL`. Kosovo also matches `XK`.
- **Western Sahara (732), Taiwan (158), Palestine (275), Puerto Rico (630), Greenland (304), Hong Kong (344), Macao (446):** regions of their own, as in ISO 3166-1.
- **Indian Ocean Territories, Ashmore and Cartier Islands:** part of Australia (036).
- **Siachen Glacier:** no id, left out.
- **First-level regions:** ISO 3166-2 as Natural Earth records it, with corrections: seven codes ISO has changed (`MX-DIF` is `MX-CMX`, `IN-OR` is `IN-OD`, and others; the old code still matches); seven shapes filed under a neighbour's code; shapes sharing one code are one region (Dublin, Metro Manila).
- **France, Italy, Spain, Belgium, United Kingdom:** drawn one level down (departments, provinces, counties), with the level above as groups: 13 regions of metropolitan France, 20 regions of Italy, 17 communities of Spain, Flanders and Wallonia, England, Scotland, Wales and Northern Ireland.
- **188 source shapes without an ISO 3166-2 code are left out:** Kosovo municipalities, Hong Kong districts, and territories that are countries in the countries file (Gibraltar, Monaco, Aruba, Guam).
- **Congressional districts:** a state's single district and delegate seats (District of Columbia and five territories) are `<state>-AL`; the source has 00 and 98.

## Licences

US Census Bureau and Natural Earth data are public domain. The TopoJSON packaging of the two npm packages is ISC: [LICENSE.us-atlas](LICENSE.us-atlas), [LICENSE.world-atlas](LICENSE.world-atlas). `regions/` is built directly from the public-domain sources.

## Not included

- **ZIP code areas, census tracts, second-level regions of the world:** about 33,000 ZIP code areas and 85,000 tracts. A backend serves them as a vector source whose features carry the id; data joins by that id.
- **Counties after 2017:** Connecticut's nine planning regions (2022, codes 09110 to 09190) have no shape.
- **Metro divisions and combined statistical areas:** only CBSA metro and micro areas.
- **Albers USA files of `us-atlas`:** not used; the map draws in Web Mercator.
