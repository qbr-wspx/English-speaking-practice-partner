import { Box3, Euler, Quaternion, Vector3 } from "three";
import { VRMUtils, type VRM, type VRMExpressionManager } from "@pixiv/three-vrm";

export function updateVrmSpeech(expressions: Pick<VRMExpressionManager, "setValue">, energy: number, speaking: boolean, previous: number, delta: number) {
  const target = speaking && Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
  const level = target === 0 ? 0 : previous + (target - previous) * Math.min(1, Math.max(0, delta) * 22);
  expressions.setValue("aa", level * 0.65);
  expressions.setValue("oh", level * 0.12);
  expressions.setValue("happy", 0.12 * (1 - level));
  return level;
}

export function prepareVrm(vrm: VRM) {
  if (!vrm.expressionManager?.getExpression("aa")) throw new Error("Avatar has no speech expression");
  VRMUtils.rotateVRM0(vrm);
  VRMUtils.combineSkeletons(vrm.scene);
  vrm.scene.traverse(object => { object.frustumCulled = false; });
  const box = new Box3().setFromObject(vrm.scene);
  vrm.scene.scale.setScalar(1.75 / box.getSize(new Vector3()).y);
  vrm.scene.position.y = -box.min.y * vrm.scene.scale.y;
  const bone = (name: "leftUpperArm" | "rightUpperArm" | "leftLowerArm" | "rightLowerArm") => vrm.humanoid.getNormalizedBoneNode(name);
  bone("leftUpperArm")?.rotation.set(0, 0, -1.22);
  bone("rightUpperArm")?.rotation.set(0, 0, 1.22);
  bone("leftLowerArm")?.rotation.set(0, -0.13, -0.1);
  bone("rightLowerArm")?.rotation.set(0, 0.13, 0.1);
  vrm.update(0);
  const head = vrm.humanoid.getNormalizedBoneNode("head");
  return { vrm, scene: vrm.scene, expressions: vrm.expressionManager, head, headBase: head?.quaternion.clone(), baseY: vrm.scene.position.y, offset: new Quaternion(), euler: new Euler() };
}
