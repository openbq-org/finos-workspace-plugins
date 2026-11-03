import { createRoot } from "react-dom/client";
import { copilotContext, exportData, exportOptions } from "./exports";
import { bindHost } from "./host";
import MapWidget from "./MapWidget";
import type { Model } from "./widget";

export default {
  async initialize() {
    return { exportOptions, exportData, copilotContext };
  },
  async render({
    model,
    el,
    signal,
    experimental,
  }: {
    model: Model;
    el: HTMLElement;
    signal: AbortSignal;
    experimental: { invoke: Parameters<typeof bindHost>[0] };
  }) {
    bindHost(experimental.invoke);
    const root = createRoot(el);
    root.render(<MapWidget model={model} />);
    signal.addEventListener("abort", () => {
      root.unmount();
      bindHost(null);
    });
  },
};
