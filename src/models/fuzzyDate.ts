import { z } from "zod";
import { IsoDay } from "./common";

/**
 * A deadline the user expressed imprecisely (SPEC §1).
 *
 * `label` is the human phrasing and is what gets displayed -- it is the source
 * of truth for what the user *meant*. `earliest`/`latest` are the machine's
 * reading of it, and exist only so streams can be sorted by urgency and so the
 * app can detect that a deadline window has opened.
 *
 * Never render `earliest` as though it were a due date. "end of Q3 2026" is a
 * window, and collapsing it to 2026-09-01 invents a precision the user
 * deliberately withheld. This is also why the Reminders mirror (SPEC §4.5)
 * refuses to map a fuzzy deadline onto a reminder's due date.
 */
export const FuzzyDate = z
  .object({
    label: z.string().min(1),
    earliest: IsoDay,
    latest: IsoDay,
  })
  .refine((d) => d.earliest <= d.latest, {
    message: "earliest must not be after latest",
    path: ["earliest"],
  });

export type FuzzyDate = z.infer<typeof FuzzyDate>;
