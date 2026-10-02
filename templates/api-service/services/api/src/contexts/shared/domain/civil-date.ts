export function toIsoDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD in the given zone; toISOString() would always answer in UTC.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDays(civilDate: string, days: number): string {
  const [year, month, day] = partsOf(civilDate, "addDays");

  // Calendar arithmetic, never 24-hour steps: a civil day is 23 or 25 hours twice a year.
  return toIsoDate(new Date(Date.UTC(year, month - 1, day + days)), "UTC");
}

export function isCivilDate(value: string): boolean {
  if (!CIVIL_DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = partsOf(value, "isCivilDate");
  // Date.UTC rolls 2026-02-30 over to 2 March, so only the round trip proves the day exists.
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)), "UTC") === value;
}

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function partsOf(civilDate: string, caller: string): [number, number, number] {
  const [year, month, day] = civilDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`${caller}: expected a YYYY-MM-DD civil date`);
  }
  if ([year, month, day].some(Number.isNaN)) {
    throw new Error(`${caller}: expected a YYYY-MM-DD civil date`);
  }

  return [year, month, day];
}

export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}
