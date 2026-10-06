import { Box3, Euler, Mesh, MeshStandardMaterial, Object3D, Quaternion, Skeleton, SkinnedMesh, Texture, Vector3 } from "three";

export function setMorph(meshes: Mesh[], name: string, value: number) {
  for (const mesh of meshes) {
    const index = mesh.morphTargetDictionary?.[name];
    if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value;
  }
}

export function updateSpeech(meshes: Mesh[], energy: number, speaking: boolean, previous: number, delta: number) {
  const target = speaking && Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
  // Silence and interruption close the mouth on the very next rendered frame.
  const level = target === 0 ? 0 : previous + (target - previous) * Math.min(1, Math.max(0, delta) * 22);
  setMorph(meshes, "viseme_aa", level * 0.7);
  setMorph(meshes, "viseme_O", level * 0.15);
  setMorph(meshes, "mouthSmileLeft", 0.28 * (1 - level));
  setMorph(meshes, "mouthSmileRight", 0.28 * (1 - level));
  return level;
}

export function prepareAvatar(scene: Object3D) {
  const box = new Box3().setFromObject(scene);
  scene.scale.setScalar(1.75 / box.getSize(new Vector3()).y);
  scene.position.y = -box.min.y * scene.scale.y;
  const glasses = scene.getObjectByName("Wolf3D_Glasses");
  if (glasses) glasses.visible = false;
  for (const [name, color] of [["Wolf3D_Outfit_Top", "#316f89"], ["Wolf3D_Outfit_Bottom", "#23374e"]]) {
    const mesh = scene.getObjectByName(name) as Mesh | undefined;
    if (mesh) for (const material of [mesh.material].flat() as MeshStandardMaterial[]) {
      // Keep the original textures available for disposal, even when styling overrides them.
      material.userData.originalTextures = [material.map, material.normalMap].filter(Boolean);
      material.map = null; material.normalMap = null; material.color.set(color); material.roughness = 0.9; material.needsUpdate = true;
    }
  }
  const align = (name: string, end: string, direction: number[]) => {
    scene.updateMatrixWorld(true);
    const bone = scene.getObjectByName(name), child = scene.getObjectByName(end);
    if (!bone?.parent || !child) throw new Error("Avatar skeleton is incomplete");
    const from = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
    const world = new Quaternion().setFromUnitVectors(from, new Vector3(...direction).normalize()).multiply(bone.getWorldQuaternion(new Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(world));
  };
  align("LeftArm", "LeftForeArm", [0.2, -1, 0]); align("RightArm", "RightForeArm", [-0.2, -1, 0]);
  align("LeftForeArm", "LeftHand", [-0.05, -1, 0.18]); align("RightForeArm", "RightHand", [0.05, -1, 0.18]);
  const faces: Mesh[] = [];
  scene.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh && mesh.morphTargetDictionary) faces.push(mesh); });
  if (!faces.some(mesh => mesh.morphTargetDictionary?.viseme_aa !== undefined)) throw new Error("Avatar has no speech expressions");
  const head = scene.getObjectByName("Head");
  return { scene, faces, head, headBase: head?.quaternion.clone(), baseY: scene.position.y, offset: new Quaternion(), euler: new Euler() };
}

export function disposeAvatar(scene: Object3D) {
  const resources = new Set<{ dispose(): void }>();
  const skeletons = new Set<Skeleton>();
  scene.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isMesh) return;
    resources.add(mesh.geometry);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
    for (const material of [mesh.material].flat()) {
      resources.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
      for (const texture of material.userData.originalTextures || []) resources.add(texture);
    }
  });
  for (const resource of resources) resource.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
