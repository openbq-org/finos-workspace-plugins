import type { Accent } from "./graph.ts";

export interface ThemeTrait {
  mode?: string;
  tokens?: Record<string, string>;
  locale?: string;
  decimals?: number;
}

const DARK = {
  background: "#1f2020",
  foreground: "#f2f2f2",
  card: "#2a2b2b",
  border: "#454747",
  "brand-main": "#3b82f6",
  "alert-success": "#22c55e",
  "alert-error": "#ef4444",
  "alert-warning": "#f59e0b",
  "alert-informative": "#38bdf8",
} as const;

const LIGHT = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  card: "#ffffff",
  border: "#d4d4d4",
  "brand-main": "#2563eb",
  "alert-success": "#16a34a",
  "alert-error": "#dc2626",
  "alert-warning": "#d97706",
  "alert-informative": "#0284c7",
} as const;

const ACCENT_TOKENS: Record<Accent, keyof typeof DARK> = {
  neutral: "border",
  brand: "brand-main",
  positive: "alert-success",
  negative: "alert-error",
  warning: "alert-warning",
  info: "alert-informative",
};

export const modeOf = (theme: ThemeTrait | undefined): "dark" | "light" =>
  theme?.mode === "light" ? "light" : "dark";

export function cssVariables(theme: ThemeTrait | undefined): Record<string, string> {
  const fallback = modeOf(theme) === "light" ? LIGHT : DARK;
  const tokens = theme?.tokens ?? {};
  const token = (name: keyof typeof DARK) => {
    const value = tokens[name];
    return typeof value === "string" && value ? value : fallback[name];
  };
  const variables: Record<string, string> = {
    "--flow-background": token("background"),
    "--flow-foreground": token("foreground"),
    "--flow-card": token("card"),
    "--flow-border": token("border"),
    "--flow-font":
      tokens["font-family"] ||
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  };
  for (const [accent, name] of Object.entries(ACCENT_TOKENS))
    variables[`--flow-accent-${accent}`] = token(name);
  return variables;
}
