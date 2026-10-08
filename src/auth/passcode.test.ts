import { describe, expect, it } from "vitest";
import { hashPasscode, verifyPasscode } from "./passcode";

describe("passcode", () => {
  it("verifies the right passcode and rejects others", () => {
    const h = hashPasscode("charizard-151");
    expect(h.startsWith("scrypt:16384:8:1:")).toBe(true);
    expect(verifyPasscode("charizard-151", h)).toBe(true);
    expect(verifyPasscode("charizard-150", h)).toBe(false);
  });

  it("salts every hash", () => {
    expect(hashPasscode("same")).not.toBe(hashPasscode("same"));
  });

  it("rejects malformed stored values instead of throwing", () => {
    expect(verifyPasscode("x", "")).toBe(false);
    expect(verifyPasscode("x", "plain-text-passcode")).toBe(false);
    expect(verifyPasscode("x", "scrypt:1:2:3::")).toBe(false);
  });
});
