import { describe, expect, it } from "vitest";
import { mouthIsOpen } from "./avatar2dMotion";
describe("approved 2D mouth states", () => {
  it("closes on silence or cancellation even when the previous state was open", () => {
    expect(mouthIsOpen(0.8, false, true)).toBe(false);
    for (const value of [0, -1, NaN, Infinity]) expect(mouthIsOpen(value, true, true)).toBe(false);
  });
  it("avoids flickering near the opening threshold", () => {
    expect(mouthIsOpen(0.13, true, false)).toBe(true);
    expect(mouthIsOpen(0.1, true, true)).toBe(true);
    expect(mouthIsOpen(0.04, true, true)).toBe(false);
    expect(mouthIsOpen(0.1, true, false)).toBe(false);
  });
});
