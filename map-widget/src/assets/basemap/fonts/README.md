# Fonts of the basemap

Glyphs of Noto Sans (Regular, Medium, Italic) for the names a map draws, as the ranges the map library asks for (`{fontstack}/{range}.pbf`, in folders named `Noto-Sans-Regular` and so on). They are files of the plugin package, read with `core:asset:read`, so a map never asks a font server for them.

Unmodified files of [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (`fonts/`), which are what the Protomaps basemap style is drawn with. The ranges kept here are Latin and its extensions, Greek, Cyrillic and general punctuation (0-1279, 7680-7935, 8192-8447): 2.1 MB. The basemap is labelled in English, so a name in another script is rare; a range that is not here is not drawn and nothing is fetched for it from anywhere else.

Noto Sans is under the SIL Open Font License 1.1: see [OFL.txt](OFL.txt). The SHA-256 of each file is in [SHA256SUMS](SHA256SUMS), which a unit test checks.
