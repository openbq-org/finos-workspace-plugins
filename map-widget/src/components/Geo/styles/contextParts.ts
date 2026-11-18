import type { ContextSchema } from "~/lib/geo/mapContext";
import { openMapTilesContext } from "./contextOpenMapTiles";
import { protomapsContext } from "./contextProtomaps";
import { CONTEXT_COLORS, type ContextParts } from "./contextShared";

export type { ContextPart } from "./contextShared";

export const contextPartsOf = (
  schema: ContextSchema,
  theme: "light" | "dark",
): ContextParts =>
  (schema === "protomaps" ? protomapsContext : openMapTilesContext)(
    CONTEXT_COLORS[theme],
  );
