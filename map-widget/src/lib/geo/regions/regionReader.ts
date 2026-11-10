import { matchCountry, matchState } from "./codes";
import { codeKey, isDigits, nameKey, nameWords } from "./fold";
import { type Entry, type Keys, stateByUsps } from "./regionKeys";
import type { MatchOptions, RegionMatch, RegionSetId } from "./regionTypes";

const unique = (ids: string[]): string[] => [...new Set(ids)];

const settled = (ids: string[]): RegionMatch => {
  const distinct = unique(ids);
  if (!distinct.length) return null;
  return distinct.length === 1 ? { id: distinct[0] } : { ambiguous: distinct.sort() };
};

function settle(
  entries: Entry[] | undefined,
  scope?: string,
  kind?: string,
): RegionMatch {
  if (!entries) return null;
  let pool =
    scope === undefined ? entries : entries.filter((entry) => entry.scope === scope);
  if (!pool.length) return null;
  const scopes = (list: Entry[]) => new Set(list.map((entry) => entry.scope)).size;
  const narrowed = (list: Entry[], keep: (entry: Entry) => boolean) => {
    const kept = list.filter(keep);
    return kept.length ? kept : list;
  };
  if (scopes(pool) > 1) pool = narrowed(pool, (entry) => entry.own);
  if (scopes(pool) === 1) {
    const level = Math.min(...pool.map((entry) => entry.level));
    pool = pool.filter((entry) => entry.level === level);
    pool = narrowed(pool, (entry) => entry.own);
    if (kind) pool = narrowed(pool, (entry) => entry.kind === kind);
  }
  return settled(pool.map((entry) => entry.id));
}

export function given<T>(
  value: unknown,
  read: (value: unknown) => T | null,
): T | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return read(value);
}

const COUNTY_WORDS =
  /^(.+?) (county|parish|borough|census area|municipality|city and borough|municipio|city)$/;

const STORED_COUNTY_KEY = /^([0-9]{2}):([a-z0-9 ]{1,60})$/;

const METRO_WORDS =
  /,?\s+((metropolitan|micropolitan) statistical area|(metro|micro)(politan)? area|[mµ]sa|metro)$/i;

const DISTRICT_WORDS = new Set(["congressional", "district", "cd", "of", "the"]);

export function reader(
  set: RegionSetId,
  keys: Keys,
): (text: string, options: MatchOptions) => RegionMatch {
  const byCode = (key: string): RegionMatch => {
    const id = keys.codes.get(key);
    return id ? { id } : null;
  };
  const byName = (text: string, scope?: string, kind?: string) =>
    settle(keys.names.get(nameKey(text)), scope, kind);

  if (set === "us-states")
    return (text) =>
      isDigits(text)
        ? text.length <= 2
          ? byCode(text.padStart(2, "0"))
          : null
        : byName(text);

  if (set === "countries")
    return (text) =>
      isDigits(text)
        ? text.length <= 3
          ? byCode(text.padStart(3, "0"))
          : null
        : byName(text);

  if (set === "us-counties") {
    const inState = (text: string, scope?: string): RegionMatch => {
      const whole = byName(text, scope);
      if (whole) return whole;
      const ended = COUNTY_WORDS.exec(nameWords(text).join(" "));
      return ended
        ? byName(ended[1], scope, ended[2] === "city" ? "city" : "county")
        : null;
    };
    return (text, options) => {
      if (isDigits(text))
        return text.length === 4 || text.length === 5
          ? byCode(text.padStart(5, "0"))
          : null;
      const state = given(options.state, matchState);
      if (state === null) return null;
      const keyed = STORED_COUNTY_KEY.exec(text);
      if (keyed)
        return state && state.code !== keyed[1] ? null : inState(keyed[2], keyed[1]);
      const comma = text.lastIndexOf(",");
      if (comma > 0) {
        const named = matchState(text.slice(comma + 1));
        if (!named || (state && state.code !== named.code)) return null;
        return inState(text.slice(0, comma), named.code);
      }
      const plain = inState(text, state?.code);
      if (plain || state) return plain;
      const words = text.split(/\s+/);
      const found: string[] = [];
      for (let take = 1; take <= 3 && take < words.length; take++) {
        const named = matchState(words.slice(-take).join(" "));
        const match = named
          ? inState(words.slice(0, -take).join(" "), named.code)
          : null;
        if (match) found.push(...("id" in match ? [match.id] : match.ambiguous));
      }
      return settled(found);
    };
  }

  if (set === "admin1")
    return (text, options) => {
      const country = given(options.country, matchCountry);
      if (country === null) return null;
      const scope = country?.short;
      const inScope = (match: RegionMatch) =>
        match && "id" in match && scope && !match.id.startsWith(`${scope}-`)
          ? null
          : match;
      const compact = codeKey(text);
      const coded = /^[A-Za-z]{2}\s*[-_./]\s*[A-Za-z0-9]{1,3}$/.test(text);
      if (coded) {
        const match = inScope(byCode(compact));
        if (match) return match;
      }
      if (scope && /^[A-Z0-9]{1,3}$/.test(compact)) {
        const forms = isDigits(compact)
          ? [compact, compact.padStart(2, "0"), compact.padStart(3, "0")]
          : [compact];
        const match = settled(
          forms.flatMap((form) => keys.codes.get(`${scope}${form}`) ?? []),
        );
        if (match) return match;
      }
      const named = byName(text, scope);
      if (named) return named;
      if (!coded && /^[A-Za-z]{2}[ ]?[A-Za-z0-9]{1,3}$/.test(text)) {
        const match = inScope(byCode(compact));
        if (match) return match;
      }
      return scope ? null : settled(keys.suffixes.get(compact) ?? []);
    };

  if (set === "us-cbsa")
    return (text) => {
      if (isDigits(text)) return text.length === 5 ? byCode(text) : null;
      return byName(text) ?? byName(text.replace(METRO_WORDS, ""));
    };

  const districtsOf = new Map<string, string[]>();
  for (const id of keys.infos.keys())
    districtsOf.set(id.slice(0, 2), [...(districtsOf.get(id.slice(0, 2)) ?? []), id]);
  return (text) => {
    if (isDigits(text))
      return text.length === 3 || text.length === 4
        ? byCode(text.padStart(4, "0"))
        : null;
    const words = nameWords(
      text
        .replace(/\bat[- ]large\b/i, " atlarge ")
        .replace(/\bdistrict of columbia\b/i, " DC ")
        .replace(/['’]s\b/g, ""),
      false,
    )
      .flatMap((word) => {
        const joined = /^([a-z]{2})([0-9]{1,2}|al)$/.exec(word);
        if (joined && stateByUsps.has(joined[1].toUpperCase()))
          return [joined[1], joined[2] === "al" ? "atlarge" : joined[2]];
        return [word.replace(/^([0-9]+)(st|nd|rd|th)$/, "$1")];
      })
      .filter((word) => !DISTRICT_WORDS.has(word));
    const numbers = words.filter(isDigits);
    const rest = words.filter((word) => !isDigits(word) && word !== "atlarge");
    let large = words.includes("atlarge");
    if (
      !large &&
      !numbers.length &&
      rest.length > 1 &&
      rest[rest.length - 1] === "al"
    ) {
      large = true;
      rest.pop();
    }
    if (numbers.length > 1 || (large && numbers.length)) return null;
    const state = matchState(rest.join(" "));
    const districts = state ? districtsOf.get(state.short) : undefined;
    if (!state || !districts) return null;
    if (!numbers.length && !large) return settled(districts);
    const whole = `${state.short}-AL`;
    const number = large ? 0 : Number(numbers[0]);
    if (keys.infos.has(whole))
      return number === 0 || number === 1 || number === 98 ? { id: whole } : null;
    const id = `${state.short}-${String(number).padStart(2, "0")}`;
    return number > 0 && keys.infos.has(id) ? { id } : null;
  };
}
