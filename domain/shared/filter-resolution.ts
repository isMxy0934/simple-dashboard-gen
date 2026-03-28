export function resolveTimeRangePreset(
  preset: string,
  timezone: string,
  now = new Date(),
): { value: string; start: string; end: string; timezone: string } {
  const currentDay = startOfDayUtc(now);
  const currentWeek = startOfWeekUtc(now);

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

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeekUtc(date: Date): Date {
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysUtc(startOfDayUtc(date), offset);
}
