import { describe, expect, it } from "vitest";
import { parseHostStatus, statusProblems } from "./status";

const reply = (one: string, two: string) => `\x02${one}\x03\r\n\x02${two}\x03\r\n\x021234,0\x03\r\n`;
const READY = reply("030,0,0,0203,000,0,0,0,000,0,0,0", "001,0,0,0,0,2,6,0,00000000,1,000");

describe("parseHostStatus", () => {
  it("reads a ready printer", () => {
    const s = parseHostStatus(READY)!;
    expect(s).toMatchObject({ paused: false, paperOut: false, headOpen: false, ribbonOut: false, formatsWaiting: 0 });
    expect(statusProblems(s)).toEqual([]);
  });

  it("spots a paused printer holding jobs", () => {
    const s = parseHostStatus(reply("030,0,1,0203,002,0,0,0,000,0,0,0", "001,0,0,0,0,2,6,0,00000000,1,000"))!;
    expect(s).toMatchObject({ paused: true, formatsWaiting: 2 });
    expect(statusProblems(s)[0]).toMatch(/paused/);
  });

  it("names an open head first, then a missing ribbon in ribbon mode", () => {
    const s = parseHostStatus(reply("030,0,1,0203,000,0,0,0,000,0,0,0", "001,0,1,1,1,2,6,0,00000000,1,000"))!;
    const p = statusProblems(s);
    expect(p[0]).toMatch(/head is open/);
    expect(p[1]).toMatch(/ribbon/);
  });

  it("says when jobs wait with no other reason", () => {
    const s = parseHostStatus(reply("030,0,0,0203,003,0,0,0,000,0,0,0", "001,0,0,0,0,2,6,0,00000000,1,000"))!;
    expect(statusProblems(s)).toEqual([expect.stringMatching(/3 sticker job/)]);
  });

  it("gives up on anything else", () => {
    expect(parseHostStatus("")).toBeNull();
    expect(parseHostStatus("garbage")).toBeNull();
  });
});
