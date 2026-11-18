export function isCalendarTime(text: string): boolean {
  const parts =
    /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?)?)?$/.exec(
      text,
    );
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  const within = (value: string | undefined, low: number, high: number) =>
    value === undefined || (Number(value) >= low && Number(value) <= high);
  if (!within(month, 1, 12)) return false;
  if (day !== undefined) {
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    if (!within(day, 1, days)) return false;
  }
  return (
    within(hour, 0, 23) &&
    within(minute, 0, 59) &&
    within(second, 0, 59) &&
    within(offsetHour, 0, 14) &&
    within(offsetMinute, 0, 59)
  );
}
