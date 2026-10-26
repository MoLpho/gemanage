export type Period = 'daily' | 'weekly' | 'monthly';

export type Game = {
  id: string;
  name: string;
  resetHour: number;
  color: string;
};

export type Task = {
  id: string;
  gameId: string;
  name: string;
  period: Period;
  weekday?: number;
  monthDay?: number;
  target: number;
  count: number;
  periodKey: string;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const key = `en-US:${timeZone}`;
  const cached = zonedFormatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  zonedFormatterCache.set(key, formatter);
  return formatter;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_MAP[record.weekday];

  if (weekday === undefined) {
    throw new Error(`unsupported weekday: ${record.weekday}`);
  }

  return {
    year: Number(record.year),
    month: Number(record.month),
    day: Number(record.day),
    hour: Number(record.hour),
    minute: Number(record.minute),
    second: Number(record.second),
    weekday
  };
}

function toDateValue(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function fromDateValue(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function formatDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const base = month - 1 + delta;
  const shiftedYear = year + Math.floor(base / 12);
  const shiftedMonth = ((base % 12) + 12) % 12 + 1;
  return { year: shiftedYear, month: shiftedMonth };
}

function normalizeResetHour(resetHour: number): number {
  return Math.max(0, Math.min(23, Math.trunc(resetHour)));
}

function getShiftedParts(now: Date, resetHour: number, timeZone: string): ZonedParts {
  const shifted = new Date(now.getTime() - normalizeResetHour(resetHour) * 60 * 60 * 1000);
  return getZonedParts(shifted, timeZone);
}

function getWeeklyAnchor(parts: ZonedParts, weekday: number): { year: number; month: number; day: number } {
  const normalizedWeekday = ((Math.trunc(weekday) % 7) + 7) % 7;
  const diff = (parts.weekday - normalizedWeekday + 7) % 7;
  const date = toDateValue(parts.year, parts.month, parts.day);
  date.setUTCDate(date.getUTCDate() - diff);
  return fromDateValue(date);
}

function getMonthlyAnchor(parts: ZonedParts, monthDay: number): { year: number; month: number; day: number } {
  const normalizedMonthDay = Math.max(1, Math.min(31, Math.trunc(monthDay)));
  const currentMonthDay = Math.min(normalizedMonthDay, daysInMonth(parts.year, parts.month));

  if (parts.day >= currentMonthDay) {
    return {
      year: parts.year,
      month: parts.month,
      day: currentMonthDay
    };
  }

  const previous = shiftMonth(parts.year, parts.month, -1);
  return {
    year: previous.year,
    month: previous.month,
    day: Math.min(normalizedMonthDay, daysInMonth(previous.year, previous.month))
  };
}

function getCurrentAnchor(task: Task, shiftedParts: ZonedParts): { year: number; month: number; day: number } {
  if (task.period === 'daily') {
    return {
      year: shiftedParts.year,
      month: shiftedParts.month,
      day: shiftedParts.day
    };
  }

  if (task.period === 'weekly') {
    return getWeeklyAnchor(shiftedParts, task.weekday ?? 0);
  }

  return getMonthlyAnchor(shiftedParts, task.monthDay ?? 1);
}

function addPeriod(anchor: { year: number; month: number; day: number }, task: Task): {
  year: number;
  month: number;
  day: number;
} {
  if (task.period === 'daily') {
    const date = toDateValue(anchor.year, anchor.month, anchor.day);
    date.setUTCDate(date.getUTCDate() + 1);
    return fromDateValue(date);
  }

  if (task.period === 'weekly') {
    const date = toDateValue(anchor.year, anchor.month, anchor.day);
    date.setUTCDate(date.getUTCDate() + 7);
    return fromDateValue(date);
  }

  const next = shiftMonth(anchor.year, anchor.month, 1);
  const normalizedMonthDay = Math.max(1, Math.min(31, Math.trunc(task.monthDay ?? 1)));
  return {
    year: next.year,
    month: next.month,
    day: Math.min(normalizedMonthDay, daysInMonth(next.year, next.month))
  };
}

function pseudoTimestamp(
  value: { year: number; month: number; day: number },
  hour = 0,
  minute = 0,
  second = 0
): number {
  return Date.UTC(value.year, value.month - 1, value.day, hour, minute, second);
}

export function computePeriodKey(task: Task, now: Date, resetHour: number, timeZone = DEFAULT_TIME_ZONE): string {
  const shifted = getShiftedParts(now, resetHour, timeZone);
  const anchor = getCurrentAnchor(task, shifted);
  return `${task.period}:${formatDate(anchor.year, anchor.month, anchor.day)}`;
}

export function clampCount(count: number, target: number): number {
  const normalizedTarget = Math.max(0, Math.trunc(target));
  const normalizedCount = Math.trunc(count);
  return Math.max(0, Math.min(normalizedTarget, normalizedCount));
}

export function applyLazyReset(task: Task, now: Date, resetHour: number, timeZone = DEFAULT_TIME_ZONE): Task {
  const currentPeriodKey = computePeriodKey(task, now, resetHour, timeZone);
  const count = task.periodKey === currentPeriodKey ? task.count : 0;

  return {
    ...task,
    periodKey: currentPeriodKey,
    count: clampCount(count, task.target)
  };
}

export function getRemainingMsToReset(task: Task, now: Date, resetHour: number, timeZone = DEFAULT_TIME_ZONE): number {
  const shifted = getShiftedParts(now, resetHour, timeZone);
  const currentAnchor = getCurrentAnchor(task, shifted);
  const nextAnchor = addPeriod(currentAnchor, task);

  const currentPseudo = pseudoTimestamp(shifted, shifted.hour, shifted.minute, shifted.second);
  const nextPseudo = pseudoTimestamp(nextAnchor);
  return Math.max(0, nextPseudo - currentPseudo);
}

export function sortIncompleteTasksByReset(
  tasks: Task[],
  games: Record<string, Game>,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE
): Task[] {
  const pending = tasks.filter((task) => task.count < task.target);

  return [...pending].sort((a, b) => {
    const gameA = games[a.gameId];
    const gameB = games[b.gameId];
    const remainingA = getRemainingMsToReset(a, now, gameA?.resetHour ?? 0, timeZone);
    const remainingB = getRemainingMsToReset(b, now, gameB?.resetHour ?? 0, timeZone);

    if (remainingA === remainingB) {
      return a.id.localeCompare(b.id);
    }

    return remainingA - remainingB;
  });
}
