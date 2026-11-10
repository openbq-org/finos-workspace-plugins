const LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  ı: "i",
  þ: "th",
  ə: "a",
};

const WORDS: Record<string, string> = {
  st: "saint",
  ste: "sainte",
  mt: "mount",
  ft: "fort",
};

export const REGION_TEXT_CHARS = 80;

export function written(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 0 && value < 1e9 ? String(value) : null;
  if (typeof value !== "string" || value.length > REGION_TEXT_CHARS) return null;
  const text = value.trim();
  return text === "" || notAvailable(text) ? null : text;
}
const notAvailable = (text: string): boolean =>
  /[^A-Za-z]/.test(text) && text.replace(/[^A-Za-z]+/g, "").toUpperCase() === "NA";

export function nameWords(text: string, shortForms = true): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøđðłıþə]/g, (letter) => LETTERS[letter] ?? letter)
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => (shortForms && Object.hasOwn(WORDS, word) ? WORDS[word] : word));
}

export const nameKey = (text: string): string => nameWords(text).join("");

export const codeKey = (text: string): string =>
  text.toUpperCase().replace(/[^A-Z0-9]+/g, "");

export const isDigits = (text: string): boolean => /^[0-9]+$/.test(text);
