import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_LENGTH, extractCode, newUnitCode, normalizeCode, stickerUrl } from "./codes";

describe("newUnitCode", () => {
  it("is 6 Crockford base32 characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = newUnitCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("never uses the letters people misread (I, L, O, U)", () => {
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("maps random bytes to the alphabet deterministically", () => {
    const bytes = [0, 1, 31, 32, 255, 64];
    expect(newUnitCode((n) => Uint8Array.from(bytes.slice(0, n)))).toBe("01Z0Z0");
  });
});

describe("normalizeCode", () => {
  it("uppercases and fixes look-alike characters", () => {
    expect(normalizeCode("k7m2qx")).toBe("K7M2QX");
    expect(normalizeCode("o1il2z")).toBe("01112Z");
    expect(normalizeCode(" K7-M2 QX ")).toBe("K7M2QX");
  });

  it("rejects anything that is not a code", () => {
    expect(normalizeCode("K7M2Q")).toBeNull();
    expect(normalizeCode("K7M2QXX")).toBeNull();
    expect(normalizeCode("K7M2Q!")).toBeNull();
    expect(normalizeCode("K7M2QU")).toBeNull();
  });
});

describe("extractCode", () => {
  it("reads the code from a sticker link on any host, any case", () => {
    expect(extractCode("HTTPS://CARDS.EXAMPLE.COM/U/K7M2QX")).toBe("K7M2QX");
    expect(extractCode("https://other.example/u/k7m2qx")).toBe("K7M2QX");
    expect(extractCode("https://cards.example.com/u/K7M2QX?x=1")).toBe("K7M2QX");
  });

  it("accepts a bare typed code", () => {
    expect(extractCode("k7m2qx")).toBe("K7M2QX");
  });

  it("ignores QR codes that are not ours", () => {
    expect(extractCode("https://example.com/some/page")).toBeNull();
    expect(extractCode("WIFI:S:show;T:WPA;P:pass;;")).toBeNull();
  });
});

describe("stickerUrl", () => {
  it("uppercases the whole link so the QR uses alphanumeric mode", () => {
    expect(stickerUrl("https://cards.example.com", "K7M2QX")).toBe("HTTPS://CARDS.EXAMPLE.COM/U/K7M2QX");
    expect(stickerUrl("https://cards.example.com/", "K7M2QX")).toBe("HTTPS://CARDS.EXAMPLE.COM/U/K7M2QX");
  });
});
