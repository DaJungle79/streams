import { z } from "zod";
import { Uuid } from "./common";

/** A flat domain: one company, "Personal", "Ideas" (SPEC §5.1). */
export const Area = z.object({
  id: Uuid,
  name: z.string().min(1),
  /** Hex, used as a subtle accent on stream rows. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb hex colour"),
});

export type Area = z.infer<typeof Area>;

/** areas.json is the whole flat list in one file (SPEC §6 storage layout). */
export const AreasFile = z.object({
  schemaVersion: z.literal(1),
  areas: z.array(Area),
});

export type AreasFile = z.infer<typeof AreasFile>;

export function newArea(name: string, color: string): Area {
  return { id: crypto.randomUUID(), name, color };
}
