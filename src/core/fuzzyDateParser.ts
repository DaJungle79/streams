import { IsoDay } from "../models/common";
import { FuzzyDate } from "../models/fuzzyDate";

/**
 * Text -> {label, earliest, latest} (SPEC §1).
 *
 * The parser's job is to find the *window* a phrase denotes, never to collapse
 * it to a point. "end of Q3 2026" means somewhere in September, and the model
 * says exactly that. Inventing 2026-09-30 would fabricate a precision the user
 * deliberately withheld -- and everything downstream (urgency sort, the §2.3
 * "window opened" trigger, the §4.5 refusal to mirror a fuzzy deadline as a due
 * date) depends on that honesty.
 *
 * `label` is always the user's own words, verbatim. It is what gets displayed;
 * earliest/latest exist only for the machine.
 *
 * Unparseable input returns null -- SPEC §1 falls back to manual pickers, so a
 * gap here is an inconvenience, never a blocker. That is why this file can
 * afford to reject rather than guess.
 */

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function day(year: number, month: number, d: number): IsoDay {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

type Window = { earliest: IsoDay; latest: IsoDay };

function monthWindow(year: number, month: number): Window {
  return { earliest: day(year, month, 1), latest: day(year, month, daysInMonth(year, month)) };
}

/** Q1 = Jan-Mar … Q4 = Oct-Dec. `q` is 1-indexed. */
function quarterMonths(q: number): [number, number, number] {
  const first = (q - 1) * 3;
  return [first, first + 1, first + 2];
}

function quarterWindow(year: number, q: number): Window {
  const [first, , last] = quarterMonths(q);
  return { earliest: day(year, first, 1), latest: day(year, last, daysInMonth(year, last)) };
}

/**
 * Thirds of a month. 1-10 / 11-20 / 21-end, so "late" absorbs the ragged tail
 * of 28-31 day months rather than leaving a gap.
 */
function monthThird(year: number, month: number, which: "early" | "mid" | "late"): Window {
  const end = daysInMonth(year, month);
  if (which === "early") return { earliest: day(year, month, 1), latest: day(year, month, 10) };
  if (which === "mid") return { earliest: day(year, month, 11), latest: day(year, month, 20) };
  return { earliest: day(year, month, 21), latest: day(year, month, end) };
}

/** "first week" = days 1-7; "last week" = the final 7 days, not a Mon-Sun week. */
function weekOfMonth(year: number, month: number, which: number | "last"): Window {
  const end = daysInMonth(year, month);
  if (which === "last") return { earliest: day(year, month, end - 6), latest: day(year, month, end) };
  const start = (which - 1) * 7 + 1;
  if (start > end) return monthWindow(year, month);
  return { earliest: day(year, month, start), latest: day(year, month, Math.min(start + 6, end)) };
}

function todayDay(today: Date): IsoDay {
  return day(today.getFullYear(), today.getMonth(), today.getDate());
}

/**
 * Deadlines point forward. With no year given, pick the soonest occurrence that
 * hasn't already closed -- in July 2026, "September" is this year and "March" is
 * next. Resolving to a window already in the past would be useless every time.
 */
function rollForward(today: Date, build: (year: number) => Window): Window {
  const base = today.getFullYear();
  const w = build(base);
  return w.latest < todayDay(today) ? build(base + 1) : w;
}

const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function yearFrom(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function finish(label: string, w: Window): FuzzyDate {
  return { label, earliest: w.earliest, latest: w.latest };
}

export function parseFuzzyDate(input: string, today: Date): FuzzyDate | null {
  const label = input.trim();
  if (!label) return null;
  const s = normalise(input);

  let m: RegExpMatchArray | null;

  // 2026-09-14 — an exact date is just a one-day window.
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    if (mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo)) return null;
    const iso = day(y, mo, d);
    return finish(label, { earliest: iso, latest: iso });
  }

  // "14 september 2026" / "14 sep"
  if ((m = s.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (${MONTH_NAMES})(?: (\\d{4}))?$`)))) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]];
    const y = yearFrom(m[3]);
    const build = (year: number): Window => {
      const iso = day(year, mo, d);
      return { earliest: iso, latest: iso };
    };
    if (d > 31) return null;
    if (y !== null) {
      if (d > daysInMonth(y, mo)) return null;
      return finish(label, build(y));
    }
    const w = rollForward(today, build);
    if (d > daysInMonth(Number(w.earliest.slice(0, 4)), mo)) return null;
    return finish(label, w);
  }

  // "september 14 2026" / "sep 14"
  if ((m = s.match(new RegExp(`^(${MONTH_NAMES}) (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`)))) {
    const mo = MONTHS[m[1]];
    const d = Number(m[2]);
    const y = yearFrom(m[3]);
    if (d > 31) return null;
    const build = (year: number): Window => {
      const iso = day(year, mo, d);
      return { earliest: iso, latest: iso };
    };
    if (y !== null) {
      if (d > daysInMonth(y, mo)) return null;
      return finish(label, build(y));
    }
    const w = rollForward(today, build);
    if (d > daysInMonth(Number(w.earliest.slice(0, 4)), mo)) return null;
    return finish(label, w);
  }

  // "last week of september 2026" / "first week of september"
  if ((m = s.match(new RegExp(`^(last|first|1st|second|2nd|third|3rd|fourth|4th) week (?:of |in )?(${MONTH_NAMES})(?: (\\d{4}))?$`)))) {
    const which = m[1] === "last" ? ("last" as const) : ORDINALS[m[1]];
    const mo = MONTHS[m[2]];
    const y = yearFrom(m[3]);
    const build = (year: number) => weekOfMonth(year, mo, which);
    return finish(label, y !== null ? build(y) : rollForward(today, build));
  }

  // "beginning/mid/end of Q3 2026" — a third of a quarter is one of its months,
  // which is what SPEC §1's own example asserts: end of Q3 2026 => Sept 1-30.
  if ((m = s.match(/^(beginning|start|early|mid|middle|end|late) (?:of |in )?q([1-4])(?: (\d{4}))?$/))) {
    const word = m[1];
    const q = Number(m[2]);
    const y = yearFrom(m[3]);
    const [first, middle, last] = quarterMonths(q);
    const mo = word === "beginning" || word === "start" || word === "early" ? first : word === "mid" || word === "middle" ? middle : last;
    const build = (year: number) => monthWindow(year, mo);
    return finish(label, y !== null ? build(y) : rollForward(today, build));
  }

  // "q3 2026" / "q3"
  if ((m = s.match(/^q([1-4])(?: (\d{4}))?$/))) {
    const q = Number(m[1]);
    const y = yearFrom(m[2]);
    const build = (year: number) => quarterWindow(year, q);
    return finish(label, y !== null ? build(y) : rollForward(today, build));
  }

  // "2026 q3"
  if ((m = s.match(/^(\d{4}) q([1-4])$/))) {
    return finish(label, quarterWindow(Number(m[1]), Number(m[2])));
  }

  // "early/mid/late september 2026"
  if ((m = s.match(new RegExp(`^(early|beginning|start|mid|middle|late|end) (?:of |in )?(${MONTH_NAMES})(?: (\\d{4}))?$`)))) {
    const word = m[1];
    const which = word === "early" || word === "beginning" || word === "start" ? ("early" as const) : word === "mid" || word === "middle" ? ("mid" as const) : ("late" as const);
    const mo = MONTHS[m[2]];
    const y = yearFrom(m[3]);
    const build = (year: number) => monthThird(year, mo, which);
    return finish(label, y !== null ? build(y) : rollForward(today, build));
  }

  // "september 2026" / "september"
  if ((m = s.match(new RegExp(`^(${MONTH_NAMES})(?: (\\d{4}))?$`)))) {
    const mo = MONTHS[m[1]];
    const y = yearFrom(m[2]);
    const build = (year: number) => monthWindow(year, mo);
    return finish(label, y !== null ? build(y) : rollForward(today, build));
  }

  // "end of 2026" / "2026"
  if ((m = s.match(/^(?:(beginning|start|early|mid|middle|end|late) (?:of |in )?)?(\d{4})$/))) {
    const y = Number(m[2]);
    if (y < 1900 || y > 3000) return null;
    const word = m[1];
    if (!word) return finish(label, { earliest: day(y, 0, 1), latest: day(y, 11, 31) });
    if (word === "mid" || word === "middle") return finish(label, { earliest: day(y, 5, 1), latest: day(y, 6, 31) });
    if (word === "end" || word === "late") return finish(label, { earliest: day(y, 9, 1), latest: day(y, 11, 31) });
    return finish(label, { earliest: day(y, 0, 1), latest: day(y, 2, 31) });
  }

  return null;
}
