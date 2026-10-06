import { describe, expect, it } from "vitest";
import { updateVrmSpeech } from "./vrmRig";

describe("VRM speech expressions", () => {
  it("closes both vowel expressions immediately on an interruption", () => {
    const values: Record<string, number> = {};
    const manager = { setValue(name: string, value: number) { values[name] = value; } };
    const level = updateVrmSpeech(manager, 0.8, true, 0, 0.05);
    expect(values.aa).toBeGreaterThan(0);
    expect(values.oh).toBeGreaterThan(0);
    expect(updateVrmSpeech(manager, 0.8, false, level, 0.001)).toBe(0);
    expect(values.aa).toBe(0);
    expect(values.oh).toBe(0);
    for (const energy of [0, -1, NaN, Infinity]) {
      expect(updateVrmSpeech(manager, energy, true, level, 0.016)).toBe(0);
      expect(values.aa).toBe(0);
    }
  });
});
