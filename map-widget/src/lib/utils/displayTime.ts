const MOMENT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MOMENT_CHARS = 40;

export interface Moment {
  year: number;
  month: number;
  day: number;
  clock?: string;
  offset?: string;
}

export function readMoment(text: unknown): Moment | null {
  if (typeof text !== "string" || text.length > MOMENT_CHARS) return null;
  const found = MOMENT.exec(text.trim());
  if (!found) return null;
  const [, y, m, d, hour, minute, zone] = found;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  if (hour === undefined) return { year, month, day };
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  const utc = zone === undefined || zone === "Z" || /^[+-]00:?00$/.test(zone);
  return {
    year,
    month,
    day,
    clock: `${hour}:${minute}`,
    ...(utc
      ? {}
      : { offset: zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone }),
  };
}

export interface TimeStyle {
  clock: boolean;
  year: boolean;
}

export function timeStyle(moments: readonly Moment[]): TimeStyle | null {
  if (moments.length === 0) return null;
  const [first] = moments;
  return {
    clock: moments.some(
      (moment) => moment.clock !== first.clock || moment.offset !== first.offset,
    ),
    year: moments.some((moment) => moment.year !== first.year),
  };
}

export function displayMoment(moment: Moment, style: TimeStyle): string {
  const clock = style.clock && moment.clock !== undefined;
  const date = `${MONTHS[moment.month - 1]} ${moment.day}${style.year || !clock ? `, ${moment.year}` : ""}`;
  if (!clock) return date;
  return `${date}, ${moment.clock}${moment.offset ? ` ${moment.offset}` : ""}`;
}

const INSIDE =
  /(^|[^\w-])(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?)(?![\w-])/g;
const TEXT_CHARS = 240;

function momentsIn(text: unknown): Moment[] {
  const whole = readMoment(text);
  if (whole) return [whole];
  if (typeof text !== "string" || text.length > TEXT_CHARS) return [];
  const found: Moment[] = [];
  for (const [, , written] of text.matchAll(INSIDE)) {
    const moment = readMoment(written);
    if (moment) found.push(moment);
  }
  return found;
}

export function displayTimes<T extends string | undefined>(texts: readonly T[]): T[] {
  const found = texts.flatMap((text) => momentsIn(text));
  if (found.length === 0) return [...texts];
  const style = timeStyle(found) ?? { clock: true, year: false };
  const shown = found.length === 1 ? { ...style, clock: true } : style;
  return texts.map((text) => {
    const whole = readMoment(text);
    if (whole) return displayMoment(whole, shown) as T;
    if (typeof text !== "string" || text.length > TEXT_CHARS) return text;
    return text.replace(INSIDE, (all, before: string, written: string) => {
      const moment = readMoment(written);
      return moment ? `${before}${displayMoment(moment, shown)}` : all;
    }) as T;
  });
}
