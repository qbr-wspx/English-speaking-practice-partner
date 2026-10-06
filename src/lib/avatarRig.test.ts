import { describe, expect, it } from "vitest";
import { Mesh } from "three";
import { updateSpeech } from "./avatarRig";

function face() {
  const mesh = new Mesh();
  mesh.morphTargetDictionary = { viseme_aa: 0, viseme_O: 1, mouthSmileLeft: 2, mouthSmileRight: 3 };
  mesh.morphTargetInfluences = [0, 0, 0, 0];
  return mesh;
}
describe("audio-driven avatar", () => {
  it("closes every facial mesh immediately on interrupt despite stale audio energy", () => {
    const meshes = [face(), face()];
    const level = updateSpeech(meshes, 0.8, true, 0, 0.05);
    expect(meshes[0].morphTargetInfluences![0]).toBeGreaterThan(0);
    expect(updateSpeech(meshes, 0.8, false, level, 0.001)).toBe(0);
    for (const mesh of meshes) expect(mesh.morphTargetInfluences!.slice(0, 2)).toEqual([0, 0]);
  });
  it("stops during silent audio gaps and rejects invalid energy", () => {
    const meshes = [face()];
    for (const energy of [0, -1, NaN, Infinity]) {
      expect(updateSpeech(meshes, energy, true, 0.7, 0.016)).toBe(0);
      expect(meshes[0].morphTargetInfluences![0]).toBe(0);
    }
    expect(updateSpeech(meshes, 5, true, 0, 1)).toBe(1);
  });
});
