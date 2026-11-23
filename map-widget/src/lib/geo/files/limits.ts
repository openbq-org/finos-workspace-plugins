const MB = 1024 * 1024;

export const GEO_FILE_LIMITS = {
  fileBytes: 32 * MB,

  zipEntries: 256,
  zipEntryBytes: 32 * MB,
  zipTotalBytes: 64 * MB,
  zipRatio: 200,
  zipRatioFloorBytes: 1 * MB,

  xmlBytes: 16 * MB,
  xmlNodes: 400_000,
  xmlDepth: 64,
  xmlAttributes: 32,
  xmlNameChars: 128,
  xmlAttributeChars: 1024,
  xmlTextChars: 8 * MB,

  jsonDepth: 64,

  features: 20_000,
  vertices: 100_000,
  parts: 2_000,
  geometryDepth: 8,

  properties: 32,
  propertyNameChars: 64,
  propertyValueChars: 512,
  nameChars: 200,
  descriptionChars: 2_000,
  columns: 64,

  groups: 500,
  groupNameChars: 120,
  layers: 16,

  overlays: 8,
  overlayBytes: 4 * MB,
  overlayTotalBytes: 16 * MB,
  overlaySide: 8192,
  overlayPixels: 16_777_216,

  notes: 24,
  noteChars: 240,
} as const;
