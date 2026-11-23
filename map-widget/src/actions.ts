import { ACTION, type CameraNow, getDriver } from "./cardActions";
import { addWidget, copyText, notify } from "./host";
import { STATIC_WIDGET, staticMap } from "./staticMap";
import { getShown } from "./widget";

const round = (value: number, places: number) => Number(value.toFixed(places));

export const viewText = ({ latitude, longitude, zoom }: CameraNow): string =>
  `${round(latitude, 5)}, ${round(longitude, 5)}, zoom ${round(zoom, 2)}`;

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

async function copyView() {
  const camera = getDriver()?.camera();
  if (!camera) return notify("warning", "The map is not drawn yet.");
  try {
    await copyText(viewText(camera));
    notify("success", "View copied.");
  } catch (cause) {
    notify("error", reason(cause));
  }
}

async function createStatic() {
  const shown = getShown();
  const made = shown ? staticMap(shown, getDriver()?.camera() ?? null) : null;
  if (!made) return notify("warning", "This map has no points, US states or countries to copy.");
  try {
    await addWidget(STATIC_WIDGET, made.data);
    notify("success", made.notice);
  } catch (cause) {
    notify("error", reason(cause));
  }
}

export async function runAction(id: string): Promise<void> {
  switch (id) {
    case ACTION.fit:
      return getDriver()?.fit();
    case ACTION.reset:
      return getDriver()?.reset();
    case ACTION.copyView:
      return copyView();
    case ACTION.static:
      return createStatic();
  }
}
