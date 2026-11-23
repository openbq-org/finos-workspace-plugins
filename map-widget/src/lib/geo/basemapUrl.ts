export const BASEMAP_URL_CHARS = 2000;

export function hostedBasemapUrl(configured: unknown): string | null {
  if (typeof configured !== "string") return null;
  const value = configured.trim();
  if (!value || value.length > BASEMAP_URL_CHARS) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}
