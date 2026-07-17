import { z } from "zod";

/**
 * App-wide defaults (SPEC §6's `settings.json`).
 *
 * Lives in the store root and syncs, but nothing here is sync-critical: a
 * conflict costs you a preference, not a stream.
 */
export const Settings = z.object({
  schemaVersion: z.literal(1),

  /**
   * The cadence a stream uses when it doesn't set its own.
   *
   * This closes the hole in SPEC §8. §8 promises every stream is covered by at
   * least one trigger, but §2's five leave an active stream with a next step,
   * no cadence and no dates surfacing *never* -- its step can rot for years.
   * Per-stream `checkInCadenceDays: null` therefore means **inherit this**, not
   * "no cadence", so coverage is the default rather than something you have to
   * remember.
   *
   * Setting this to null disables the safety net globally. That's allowed --
   * it's a deliberate, informed choice, which is exactly what the old hole
   * wasn't.
   *
   * There is no per-stream "never": a stream you never want to review isn't
   * active, it's parked (§1), and parked streams are silent by design.
   */
  defaultCheckInCadenceDays: z.number().int().positive().nullable(),

  /** SPEC §2.4: "default 7 days, configurable". */
  waitingThresholdDays: z.number().int().positive(),

  /** SPEC §2.3: milestone "within 7 days". */
  milestoneHorizonDays: z.number().int().positive(),

  /** SPEC §4.3: the single daily digest, "default 08:30". */
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM"),
});

export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  // 30 days: slow enough not to nag an idea you jotted down, fast enough that
  // nothing rots unnoticed for a quarter. Per-stream cadence (7 for a company
  // under governance) overrides it.
  defaultCheckInCadenceDays: 30,
  waitingThresholdDays: 7,
  milestoneHorizonDays: 7,
  digestTime: "08:30",
};
