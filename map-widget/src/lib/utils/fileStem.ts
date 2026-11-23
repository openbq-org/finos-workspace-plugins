const FILE_STEM_CHARS = 80;

export function fileStem(title: string | undefined, fallback: string): string {
  const stem = (title ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FILE_STEM_CHARS)
    .replace(/-+$/, "");
  return stem || fallback;
}
