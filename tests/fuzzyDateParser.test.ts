import { describe, expect, it } from "vitest";
import { parseFuzzyDate } from "../src/core/fuzzyDateParser";
import { FuzzyDate } from "../src/models/fuzzyDate";

/** Mid-July 2026, so "September" rolls to this year and "March" to next. */
const TODAY = new Date(2026, 6, 17);

const w = (s: string) => {
  const r = parseFuzzyDate(s, TODAY);
  return r ? `${r.earliest}..${r.latest}` : null;
};

describe("SPEC §1's own example", () => {
  it('"end of Q3 2026" is September, exactly as the spec asserts', () => {
    expect(parseFuzzyDate("end of Q3 2026", TODAY)).toEqual({
      label: "end of Q3 2026",
      earliest: "2026-09-01",
      latest: "2026-09-30",
    });
  });
});

describe("exact dates", () => {
  it("ISO", () => expect(w("2026-09-14")).toBe("2026-09-14..2026-09-14"));
  it("day month year", () => expect(w("14 September 2026")).toBe("2026-09-14..2026-09-14"));
  it("month day year", () => expect(w("September 14, 2026")).toBe("2026-09-14..2026-09-14"));
  it("abbreviated", () => expect(w("14 Sep 2026")).toBe("2026-09-14..2026-09-14"));
  it("ordinal suffix", () => expect(w("14th September 2026")).toBe("2026-09-14..2026-09-14"));
  it("an exact date is a one-day window, not a point", () => {
    const r = parseFuzzyDate("2026-09-14", TODAY)!;
    expect(r.earliest).toBe(r.latest);
  });
  it("rejects an impossible day", () => expect(w("2026-02-30")).toBeNull());
  it("rejects 31 February by name", () => expect(w("31 February 2026")).toBeNull());
  it("accepts a real leap day", () => expect(w("2028-02-29")).toBe("2028-02-29..2028-02-29"));
  it("rejects a non-leap 29 Feb", () => expect(w("2026-02-29")).toBeNull());
});

describe("quarters", () => {
  it("whole quarter", () => expect(w("Q3 2026")).toBe("2026-07-01..2026-09-30"));
  it("Q1", () => expect(w("Q1 2027")).toBe("2027-01-01..2027-03-31"));
  it("Q4", () => expect(w("Q4 2026")).toBe("2026-10-01..2026-12-31"));
  it("year-first form", () => expect(w("2026 Q3")).toBe("2026-07-01..2026-09-30"));
  it("beginning of a quarter is its first month", () =>
    expect(w("beginning of Q3 2026")).toBe("2026-07-01..2026-07-31"));
  it("mid quarter is its middle month", () =>
    expect(w("mid Q3 2026")).toBe("2026-08-01..2026-08-31"));
  it("end of quarter is its last month", () =>
    expect(w("end of Q3 2026")).toBe("2026-09-01..2026-09-30"));
  it("rejects Q5", () => expect(w("Q5 2026")).toBeNull());
});

describe("months", () => {
  it("month + year", () => expect(w("September 2026")).toBe("2026-09-01..2026-09-30"));
  it("30-day month ends on the 30th", () => expect(w("April 2026")).toBe("2026-04-01..2026-04-30"));
  it("February in a leap year ends on the 29th", () =>
    expect(w("February 2028")).toBe("2028-02-01..2028-02-29"));
  it("case-insensitive", () => expect(w("SEPTEMBER 2026")).toBe("2026-09-01..2026-09-30"));
  it('"sept" is accepted', () => expect(w("sept 2026")).toBe("2026-09-01..2026-09-30"));
});

describe("thirds of a month", () => {
  it("early", () => expect(w("early September 2026")).toBe("2026-09-01..2026-09-10"));
  it("mid", () => expect(w("mid September 2026")).toBe("2026-09-11..2026-09-20"));
  it("late", () => expect(w("late September 2026")).toBe("2026-09-21..2026-09-30"));
  it("late absorbs a 31-day tail — no gap at the end of the month", () =>
    expect(w("late August 2026")).toBe("2026-08-21..2026-08-31"));
  it("late February leap year", () => expect(w("late February 2028")).toBe("2028-02-21..2028-02-29"));
  it("the three thirds tile the month with no gap or overlap", () => {
    for (const month of ["January", "April", "February"]) {
      const e = parseFuzzyDate(`early ${month} 2026`, TODAY)!;
      const m = parseFuzzyDate(`mid ${month} 2026`, TODAY)!;
      const l = parseFuzzyDate(`late ${month} 2026`, TODAY)!;
      const whole = parseFuzzyDate(`${month} 2026`, TODAY)!;
      expect(e.earliest, month).toBe(whole.earliest);
      expect(addOne(e.latest), month).toBe(m.earliest);
      expect(addOne(m.latest), month).toBe(l.earliest);
      expect(l.latest, month).toBe(whole.latest);
    }
  });
});

const addOne = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day + 1, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

describe("weeks", () => {
  it("last week of a 30-day month", () =>
    expect(w("last week of September 2026")).toBe("2026-09-24..2026-09-30"));
  it("last week of a 31-day month", () =>
    expect(w("last week of August 2026")).toBe("2026-08-25..2026-08-31"));
  it("first week", () => expect(w("first week of September 2026")).toBe("2026-09-01..2026-09-07"));
  it("second week", () => expect(w("second week of September 2026")).toBe("2026-09-08..2026-09-14"));
  it("last week is always exactly 7 days", () => {
    for (const month of ["February 2026", "February 2028", "April 2026", "December 2026"]) {
      const r = parseFuzzyDate(`last week of ${month}`, TODAY)!;
      const days = (Date.parse(r.latest) - Date.parse(r.earliest)) / 86400000;
      expect(days, month).toBe(6);
    }
  });
});

describe("year inference — deadlines point forward", () => {
  it("a month later this year stays this year", () =>
    expect(w("September")).toBe("2026-09-01..2026-09-30"));
  it("a month already past rolls to next year", () =>
    expect(w("March")).toBe("2027-03-01..2027-03-31"));
  it("the current month does not roll — its window is still open", () =>
    expect(w("July")).toBe("2026-07-01..2026-07-31"));
  it("the current quarter does not roll", () => expect(w("Q3")).toBe("2026-07-01..2026-09-30"));
  it("a past quarter rolls", () => expect(w("Q1")).toBe("2027-01-01..2027-03-31"));
  it("a bare day-month in the past rolls", () =>
    expect(w("3 March")).toBe("2027-03-03..2027-03-03"));
  it("an explicit past year is honoured, not rolled — the user meant it", () =>
    expect(w("March 2020")).toBe("2020-03-01..2020-03-31"));
});

describe("years", () => {
  it("bare year", () => expect(w("2027")).toBe("2027-01-01..2027-12-31"));
  it("end of year", () => expect(w("end of 2026")).toBe("2026-10-01..2026-12-31"));
});

describe("rejection — SPEC §1 falls back to manual pickers, so guessing is worse than declining", () => {
  for (const bad of [
    "",
    "   ",
    "soon",
    "when it's ready",
    "next sprint",
    "asap",
    "Q",
    "13/14/2026",
    "banana",
    "the end of time",
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(parseFuzzyDate(bad, TODAY)).toBeNull());
  }

  it("rejects an ambiguous slash date rather than guess D/M vs M/D", () => {
    // 03/04/2026 is 3 April to a European and 4 March to an American. A wrong
    // guess is a silently wrong deadline; declining costs two date pickers.
    expect(parseFuzzyDate("03/04/2026", TODAY)).toBeNull();
  });
});

describe("output contract", () => {
  it("label is preserved verbatim, including case and spacing", () => {
    expect(parseFuzzyDate("  End of Q3 2026  ", TODAY)!.label).toBe("End of Q3 2026");
  });

  it("every parse produces a schema-valid FuzzyDate", () => {
    const inputs = [
      "2026-09-14", "Q3 2026", "end of Q3 2026", "September 2026", "early September 2026",
      "late February 2028", "last week of September 2026", "March", "2027", "end of 2026",
      "14 Sep 2026", "second week of September 2026", "mid Q3 2026",
    ];
    for (const i of inputs) {
      const r = parseFuzzyDate(i, TODAY);
      expect(r, i).not.toBeNull();
      expect(FuzzyDate.safeParse(r).success, i).toBe(true);
    }
  });

  it("earliest never exceeds latest, across a wide sweep", () => {
    const months = Object.keys({ january: 0, february: 0, march: 0, april: 0, may: 0, june: 0, july: 0, august: 0, september: 0, october: 0, november: 0, december: 0 });
    const shapes = (mo: string) => [mo, `early ${mo}`, `mid ${mo}`, `late ${mo}`, `first week of ${mo}`, `last week of ${mo}`];
    for (const mo of months) {
      for (const s of shapes(mo)) {
        for (const year of ["", " 2026", " 2027", " 2028"]) {
          const r = parseFuzzyDate(s + year, TODAY);
          expect(r, s + year).not.toBeNull();
          expect(r!.earliest <= r!.latest, s + year).toBe(true);
        }
      }
    }
  });
});
