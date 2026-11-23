import { createContext, type ReactNode, useContext } from "react";

export interface MapPanelHost {
  actions?: ReactNode;
  empty?: string;
}

export const MapPanelHostContext = createContext<MapPanelHost | null>(null);

export const useMapPanelHost = (): MapPanelHost | null =>
  useContext(MapPanelHostContext);
