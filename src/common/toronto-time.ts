import { DateTime } from 'luxon';

/** Application business timezone (binary engine, crons, holidays, reporting). */
export const APP_ZONE = 'America/Toronto';

export function nowToronto(): DateTime {
  return DateTime.now().setZone(APP_ZONE);
}

/** Current instant as JS Date (same absolute time as UTC `new Date()`). */
export function nowInstant(): Date {
  return DateTime.now().toJSDate();
}

export function todayStartToronto(): Date {
  return nowToronto().startOf('day').toJSDate();
}

export function todayEndToronto(): Date {
  return nowToronto().endOf('day').toJSDate();
}

/**
 * Inclusive “calendar day in Toronto” overlap check for DB date fields
 * (e.g. deposit bonus active “today” in Toronto).
 */
export function depositBonusActiveWhereToronto(): {
  startDate: { lte: Date };
  endDate: { gte: Date };
} {
  const start = nowToronto().startOf('day').toJSDate();
  const end = nowToronto().endOf('day').toJSDate();
  return {
    startDate: { lte: end },
    endDate: { gte: start },
  };
}

/** API query param: start of that calendar day in Toronto. */
export function parseQueryDateStart(input: string): Date {
  const dt = DateTime.fromISO(input, { zone: APP_ZONE });
  if (dt.isValid) {
    return dt.startOf('day').toJSDate();
  }
  return DateTime.fromJSDate(new Date(input))
    .setZone(APP_ZONE)
    .startOf('day')
    .toJSDate();
}

/** API query param: end of that calendar day in Toronto. */
export function parseQueryDateEnd(input: string): Date {
  const dt = DateTime.fromISO(input, { zone: APP_ZONE });
  if (dt.isValid) {
    return dt.endOf('day').toJSDate();
  }
  return DateTime.fromJSDate(new Date(input))
    .setZone(APP_ZONE)
    .endOf('day')
    .toJSDate();
}

/** Admin ISO date string: start of that day in Toronto (for ranges). */
export function parseAdminDateStart(input: string): Date {
  return parseQueryDateStart(input);
}

/** Admin ISO date string: end of that day in Toronto (inclusive). */
export function parseAdminDateEnd(input: string): Date {
  return parseQueryDateEnd(input);
}

/** Holiday / calendar date string stored as midnight Toronto (same pattern as other features). */
export function holidayDateFromInput(input: string): Date {
  return parseQueryDateStart(input);
}

export function torontoLocaleTimestamp(): string {
  return nowToronto().toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
}

export function plusMinutesFrom(minutes: number): Date {
  return nowToronto().plus({ minutes }).toJSDate();
}

export function plusDaysFromNow(days: number): Date {
  return nowToronto().plus({ days }).toJSDate();
}

/** Rolling window: N hours before now (absolute instants; zone-stable). */
export function hoursAgo(hours: number): Date {
  return DateTime.now().minus({ hours }).toJSDate();
}
