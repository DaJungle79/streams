import { describe, expect, it } from "vitest";
import { capture, parseCapture, resolveArea } from "../src/core/capture";

const areas = [
  { id: "1", name: "Acme" },
  { id: "2", name: "Personal" },
  { id: "3", name: "Ideas" },
];

describe("parseCapture", () => {
  it("plain text is all title", () => {
    expect(parseCapture("Call the auditors")).toEqual({ title: "Call the auditors", areaName: null });
  });

  it("reads the >area marker", () => {
    expect(parseCapture("Call the auditors >Acme")).toEqual({
      title: "Call the auditors",
      areaName: "Acme",
    });
  });

  it("tolerates no space before the marker", () => {
    expect(parseCapture("Call the auditors>Acme").areaName).toBe("Acme");
  });

  it("tolerates a space after the marker", () => {
    expect(parseCapture("Call the auditors > Acme").areaName).toBe("Acme");
  });

  it("trims", () => {
    expect(parseCapture("   Call them   >  Acme  ")).toEqual({ title: "Call them", areaName: "Acme" });
  });

  it("an area name with spaces survives", () => {
    expect(parseCapture("Ship it >Big Client Co").areaName).toBe("Big Client Co");
  });

  it("keeps a > that's part of the sentence when it's not the last one", () => {
    expect(parseCapture("revenue > costs >Acme")).toEqual({ title: "revenue > costs", areaName: "Acme" });
  });

  it("splits on the last > even when it's punctuation — capture() resolves that", () => {
    expect(parseCapture("revenue > costs")).toEqual({ title: "revenue", areaName: "costs" });
  });

  it("a trailing > is a stray character, not syntax", () => {
    expect(parseCapture("Call them >")).toEqual({ title: "Call them >", areaName: null });
  });

  it("a leading > with no title is not syntax either", () => {
    expect(parseCapture(">Acme")).toEqual({ title: ">Acme", areaName: null });
  });

  it("empty in, empty out", () => {
    expect(parseCapture("")).toEqual({ title: "", areaName: null });
    expect(parseCapture("   ")).toEqual({ title: "", areaName: null });
  });
});

describe("resolveArea", () => {
  it("matches exactly", () => expect(resolveArea("Acme", areas)?.id).toBe("1"));
  it("is case-insensitive", () => expect(resolveArea("acme", areas)?.id).toBe("1"));
  it("matches an unambiguous prefix", () => expect(resolveArea("ac", areas)?.id).toBe("1"));
  it("returns null for no match", () => expect(resolveArea("nope", areas)).toBeNull());
  it("returns null for null", () => expect(resolveArea(null, areas)).toBeNull());

  it("refuses an ambiguous prefix rather than guess", () => {
    // Filing a thought in the wrong area hides it somewhere you won't look.
    const two = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Acorn" },
    ];
    expect(resolveArea("ac", two)).toBeNull();
  });

  it("prefers an exact match over a prefix collision", () => {
    const two = [
      { id: "1", name: "Ac" },
      { id: "2", name: "Acme" },
    ];
    expect(resolveArea("ac", two)?.id).toBe("1");
  });
});

describe("capture — the thought survives, always", () => {
  it("files into a named area", () => {
    expect(capture("Call the auditors >Acme", areas)).toEqual({
      title: "Call the auditors",
      area: areas[0],
    });
  });

  it("keeps the WHOLE title when > was punctuation, not syntax", () => {
    // The bug this function exists to prevent: "revenue" is not the thought.
    expect(capture("revenue > costs", areas)).toEqual({ title: "revenue > costs", area: null });
  });

  it("keeps the whole title when the area simply doesn't exist yet", () => {
    expect(capture("Ship it >Nonexistent", areas)).toEqual({ title: "Ship it >Nonexistent", area: null });
  });

  it("keeps the whole title when the prefix is ambiguous", () => {
    const two = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Acorn" },
    ];
    expect(capture("Ship it >ac", two)).toEqual({ title: "Ship it >ac", area: null });
  });

  it("plain text with no marker is untouched", () => {
    expect(capture("Just a thought", areas)).toEqual({ title: "Just a thought", area: null });
  });

  it("resolves by prefix when unambiguous", () => {
    expect(capture("Ship it >pers", areas).area).toEqual(areas[1]);
  });

  it("never returns a title shorter than the thought unless it filed the area", () => {
    // Property: either we filed it somewhere, or we kept every character.
    for (const input of [
      "revenue > costs",
      "a > b > c",
      "Ship it >Nonexistent",
      "plain",
      "trailing >",
      ">leading",
    ]) {
      const r = capture(input, areas);
      if (r.area === null) expect(r.title, input).toBe(input.trim());
    }
  });
});
