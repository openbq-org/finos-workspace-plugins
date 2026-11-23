export const ACTION = {
  dataTable: "data-table",
  static: "static",
  fit: "fit",
  reset: "reset-view",
  copyView: "copy-view",
} as const;

export interface CameraNow {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface CardDriver {
  fit: () => void;
  reset: () => void;
  camera: () => CameraNow;
}

let driver: CardDriver | null = null;

export const setDriver = (next: CardDriver | null): void => {
  driver = next;
};

export const getDriver = (): CardDriver | null => driver;
