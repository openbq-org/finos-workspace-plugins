import { useSyncExternalStore } from "react";

export interface PluginTheme {
  mode: "dark" | "light";
  tokens: Record<string, string>;
}

const FALLBACK_SURFACE = { dark: "#06122f", light: "#ffffff" } as const;

let current: PluginTheme = { mode: "dark", tokens: {} };
const listeners = new Set<() => void>();

export function setTheme(next: { mode?: unknown; tokens?: unknown } | undefined): void {
  const mode = next?.mode === "light" ? "light" : "dark";
  const tokens =
    next?.tokens && typeof next.tokens === "object"
      ? (next.tokens as Record<string, string>)
      : {};
  current = { mode, tokens };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = (): PluginTheme =>
  useSyncExternalStore(subscribe, () => current);

export const surfaceOf = ({ mode, tokens }: PluginTheme): string =>
  tokens.card ?? tokens.background ?? FALLBACK_SURFACE[mode];
