export function resolveTimeRangePreset(
  preset: string,
  timezone: string,
  now = new Date(),
): { value: string; start: string; end: string; timezone: string } {
  const currentDay = startOfDayInTimezone(now, timezone);
  const currentWeek = startOfWeekInTimezone(now, timezone);

  if (preset === "today") {
    return {
      value: preset,
      start: formatUtcDate(currentDay),
      end: formatUtcDate(addDaysUtc(currentDay, 1)),
      timezone,
    };
  }

  if (preset === "this_week") {
    return {
      value: preset,
      start: formatUtcDate(currentWeek),
      end: formatUtcDate(addDaysUtc(currentWeek, 7)),
      timezone,
    };
  }

  if (preset === "last_12_weeks") {
    const start = addDaysUtc(currentWeek, -11 * 7);
    return {
      value: preset,
      start: formatUtcDate(start),
      end: formatUtcDate(addDaysUtc(currentWeek, 7)),
      timezone,
    };
  }

  throw new Error(`Unsupported time range preset: ${preset}`);
}

export function resolveSingleSelectValue(
  rawValue: string,
  options: { label: string; value: string }[],
): { value: string; label: string } {
  const matched = options.find((option) => option.value === rawValue);
  if (matched) {
    return { value: matched.value, label: matched.label };
  }

  return {
    value: rawValue,
    label: rawValue,
  };
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfDayInTimezone(date: Date, timezone: string): Date {
  const parts = localDateParts(date, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function startOfWeekInTimezone(date: Date, timezone: string): Date {
  const currentDay = startOfDayInTimezone(date, timezone);
  const day = currentDay.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysUtc(currentDay, offset);
}

function localDateParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}
