import { GEO_FILE_LIMITS as LIMITS } from "./limits";

export type GeoCount =
  | "featuresCut"
  | "verticesCut"
  | "partsCut"
  | "outOfRange"
  | "badGeometry"
  | "propertiesCut"
  | "textCut"
  | "addresses"
  | "remote"
  | "groupsCut"
  | "overlaysCut"
  | "overlaysTooLarge"
  | "overlaysMissing"
  | "overlaysUnreadable"
  | "overlaysNotInArchive"
  | "unsupported";

const n = (count: number) => count.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) =>
  `${n(count)} ${count === 1 ? one : many}`;

export const SENTENCES: Record<GeoCount, (count: number) => string> = {
  featuresCut: () =>
    `The file has more than ${n(LIMITS.features)} features. Only the first ${n(LIMITS.features)} are shown.`,
  verticesCut: (count) =>
    `${plural(count, "shape was", "shapes were")} left out: the lines and areas of one file have at most ${n(LIMITS.vertices)} positions together. Simplify the file to see all of it.`,
  partsCut: (count) =>
    `${plural(count, "shape", "shapes")} with more than ${n(LIMITS.parts)} parts ${count === 1 ? "was" : "were"} left out.`,
  outOfRange: (count) =>
    `${plural(count, "feature was", "features were")} left out: a position is not a longitude from -180 to 180 and a latitude from -90 to 90.`,
  badGeometry: (count) =>
    `${plural(count, "feature was", "features were")} left out: a line needs two positions and an area three.`,
  propertiesCut: () =>
    `Some features have more than ${LIMITS.properties} properties. Only the first ${LIMITS.properties} of each are kept.`,
  textCut: () => "Some long texts were cut.",
  addresses: (count) =>
    `${plural(count, "value that is", "values that are")} an address ${count === 1 ? "was" : "were"} left out. Addresses in a file are not kept.`,
  remote: (count) =>
    `${plural(count, "link", "links")} to other servers (icons, images, network links, schemas, models) ${count === 1 ? "was" : "were"} not followed.`,
  groupsCut: () =>
    `The file has more than ${n(LIMITS.groups)} folders. What is in the others is shown in the folder around them.`,
  overlaysCut: () =>
    `The file has more than ${LIMITS.overlays} image overlays. Only the first ${LIMITS.overlays} are shown.`,
  overlaysTooLarge: (count) =>
    `${plural(count, "image overlay was", "image overlays were")} left out: an image has at most ${LIMITS.overlayBytes / 1024 / 1024} MB and ${n(LIMITS.overlaySide)} pixels a side.`,
  overlaysMissing: (count) =>
    `${plural(count, "image overlay was", "image overlays were")} left out: the image is not in the archive.`,
  overlaysUnreadable: (count) =>
    `${plural(count, "image overlay was", "image overlays were")} left out: the image is not a PNG, a JPEG or a WebP that can be read.`,
  overlaysNotInArchive: (count) =>
    `${plural(count, "image overlay was", "image overlays were")} left out: an image is read only from inside a KMZ archive.`,
  unsupported: (count) =>
    `${plural(count, "element", "elements")} the map does not read (network links, screen and photo overlays, models, tours) ${count === 1 ? "was" : "were"} left out.`,
};

export const COUNT_ORDER = Object.keys(SENTENCES) as GeoCount[];
