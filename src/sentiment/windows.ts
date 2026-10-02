/**
 * Time-window resolution without new runtime dependencies: wall-clock to UTC
 * conversion via Intl timezone offsets.
 *
 * Calendar windows (today, yesterday) run from the configured day-start time
 * (default local midnight) to the next day's day-start, in the configured
 * IANA timezone. Rolling windows (last-24h, Nh, Nd) are UTC-relative to the
 * injected now. Inclusion is start-inclusive, end-exclusive.
 */

export interface WindowBounds {
  startMs: number;
  endMs: number;
  label: string;
}

export interface AbsoluteBounds {
  since?: string;
  until?: string;
}

export type WindowSpec =
  | "today"
  | "yesterday"
  | "last-24h"
  | "all"
  | { kind: "hours"; hours: number }
  | { kind: "days"; days: number };

export function parseWindowSpec(spec: string): WindowSpec {
  if (spec === "today" || spec === "yesterday" || spec === "all") return spec;
  if (spec === "last-24h") return "last-24h";
  const match = /^([0-9]+)(h|d)$/.exec(spec);
  if (!match) {
    throw new Error(
      `invalid window spec: '${spec}' (expected today, yesterday, last-24h, Nh, Nd, or all)`,
    );
  }
  const amount = Number(match[1]);
  if (match[2] === "h") return { kind: "hours", hours: amount };
  return { kind: "days", days: amount };
}

export function parseDayStart(dayStart: string): { hours: number; minutes: number } {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(dayStart);
  if (!match) {
    throw new Error(`invalid day-start: '${dayStart}' (expected HH:MM)`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`invalid day-start: '${dayStart}'`);
  }
  return { hours, minutes };
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockInZone(utcMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // hour12 formatting can yield "24" for midnight on some runtimes.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of the timezone at the given UTC instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const wall = wallClockInZone(utcMs, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in a timezone to UTC ms.
 * Spring-forward gaps clamp forward to the transition instant; fall-back
 * ambiguity resolves earlier (the pre-transition offset is kept).
 */
function zonedWallTimeToUtcMs(wall: WallClock, timeZone: string): number {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const offset = zoneOffsetMs(guess, timeZone);
  const candidateA = guess - offset;
  const offsetAtCandidate = zoneOffsetMs(candidateA, timeZone);
  if (offsetAtCandidate === offset) return candidateA;

  const candidateB = guess - offsetAtCandidate;
  const aMatches = wallMatchesInstant(wall, candidateA, timeZone);
  const bMatches = wallMatchesInstant(wall, candidateB, timeZone);
  if (aMatches && bMatches) {
    // Ambiguity (fall-back): resolve to the earlier instant.
    return Math.min(candidateA, candidateB);
  }
  if (aMatches) return candidateA;
  if (bMatches) return candidateB;
  // Gap (spring-forward): the wall time does not exist; clamp forward to
  // the transition instant.
  return findTransitionInstant(
    Math.min(candidateA, candidateB),
    Math.max(candidateA, candidateB),
    offset,
    timeZone,
  );
}

function wallMatchesInstant(wall: WallClock, utcMs: number, timeZone: string): boolean {
  const actual = wallClockInZone(utcMs, timeZone);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute &&
    actual.second === wall.second
  );
}

function findTransitionInstant(
  lowMs: number,
  highMs: number,
  beforeOffset: number,
  timeZone: string,
): number {
  let lo = lowMs;
  let hi = highMs;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zoneOffsetMs(mid, timeZone) === beforeOffset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

function addDays(wall: WallClock, days: number): WallClock {
  const base = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
  };
}

function formatIsoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

function formatDayStart(dayStart: { hours: number; minutes: number }): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dayStart.hours)}:${pad(dayStart.minutes)}`;
}

export function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`invalid IANA timezone: '${timeZone}'`);
  }
}

export function resolveWindow(
  spec: WindowSpec | string,
  nowMs: number,
  timezone: string,
  dayStart = "00:00",
  bounds: AbsoluteBounds = {},
): WindowBounds {
  validateTimeZone(timezone);
  const dayStartTime = parseDayStart(dayStart);
  const absolute = resolveAbsoluteBounds(bounds);
  if (absolute) return absolute;

  const resolved: WindowSpec = typeof spec === "string" ? parseWindowSpec(spec) : spec;

  if (resolved === "all") {
    return { startMs: 0, endMs: nowMs, label: "all time" };
  }

  if (resolved === "last-24h" || (typeof resolved === "object" && "hours" in resolved)) {
    const hours = resolved === "last-24h" ? 24 : resolved.hours;
    const startMs = nowMs - hours * 3_600_000;
    return {
      startMs,
      endMs: nowMs,
      label: `${resolved === "last-24h" ? "last-24h" : `${hours}h`} ${formatIsoZ(startMs)}..${formatIsoZ(nowMs)}`,
    };
  }

  if (typeof resolved === "object" && "days" in resolved) {
    const startMs = nowMs - resolved.days * 86_400_000;
    return {
      startMs,
      endMs: nowMs,
      label: `${resolved.days}d ${formatIsoZ(startMs)}..${formatIsoZ(nowMs)}`,
    };
  }

  // Calendar windows: the wall-clock calendar date of `now` in the timezone,
  // anchored at the configured day-start.
  const wall = wallClockInZone(nowMs, timezone);
  const anchor = addDays(wall, resolved === "yesterday" ? -1 : 0);
  const startMs = zonedWallTimeToUtcMs(
    { ...anchor, hour: dayStartTime.hours, minute: dayStartTime.minutes, second: 0 },
    timezone,
  );
  const endMs = zonedWallTimeToUtcMs(
    { ...addDays(anchor, 1), hour: dayStartTime.hours, minute: dayStartTime.minutes, second: 0 },
    timezone,
  );
  return {
    startMs,
    endMs,
    label: `${resolved} ${formatDayStart(dayStartTime)}-${formatDayStart(dayStartTime)} ${timezone}`,
  };
}

function resolveAbsoluteBounds(bounds: AbsoluteBounds): WindowBounds | undefined {
  if (!bounds.since && !bounds.until) return undefined;
  const startMs = bounds.since ? requireDate(bounds.since).getTime() : 0;
  const endMs = bounds.until
    ? requireDate(bounds.until).getTime()
    : Number.MAX_SAFE_INTEGER;
  return {
    startMs,
    endMs,
    label: `since ${bounds.since ?? "-infinity"} until ${bounds.until ?? "+infinity"}`,
  };
}

function requireDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid absolute timestamp: '${value}'`);
  }
  return date;
}

export function isInWindow(timestampMs: number, window: WindowBounds): boolean {
  return timestampMs >= window.startMs && timestampMs < window.endMs;
}
