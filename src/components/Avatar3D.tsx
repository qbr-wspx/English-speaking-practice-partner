import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, PMREMGenerator, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { ConversationPhase } from "../store/conversation";
import { useConversationStore } from "../store/conversation";
import { prepareVrm, updateVrmSpeech } from "../lib/vrmRig";

interface Props { mouthLevel: number; phase: ConversationPhase; quality: "standard" | "low"; reducedMotion: boolean; scenarioId: string }
const rooms: Record<string, [string, string]> = {
  "cafe-ordering": ["#e9e4dc", "#a38b70"], "restaurant-dining": ["#eee2df", "#aa827e"],
  "hotel-checkin": ["#e9e5db", "#b19a69"], "airport-travel": ["#e0eaf0", "#779faf"],
  "shopping-returns": ["#e8e2ef", "#a092b6"], "directions-transit": ["#e2eae3", "#86a493"],
  "job-interview": ["#e1e7ef", "#8197b3"], "daily-social": ["#e6eadf", "#94a582"],
};
function Room({ scenarioId }: { scenarioId: string }) {
  const [background, accent] = rooms[scenarioId] || ["#e4edf3", "#729bb2"];
  return <group>
    <color attach="background" args={[background]} />
    <mesh position={[0, 1.3, -0.85]}><planeGeometry args={[8, 8]} /><meshStandardMaterial color={background} roughness={1} /></mesh>
    <mesh position={[-0.72, 1.55, -0.8]}><boxGeometry args={[0.75, 1.5, 0.025]} /><meshStandardMaterial color="#f6fafc" roughness={1} /></mesh>
    {[-1.11, -0.72, -0.33].map(x => <mesh key={x} position={[x, 1.55, -0.77]}><boxGeometry args={[0.018, 1.54, 0.04]} /><meshStandardMaterial color={accent} /></mesh>)}
    <mesh position={[-0.72, 1.55, -0.77]}><boxGeometry args={[0.8, 0.018, 0.04]} /><meshStandardMaterial color={accent} /></mesh>
    <mesh position={[0.7, 1.55, -0.79]}><circleGeometry args={[0.31, 48]} /><meshStandardMaterial color={accent} roughness={1} /></mesh>
    <mesh position={[0.76, 0.84, -0.47]}><cylinderGeometry args={[0.11, 0.085, 0.19, 24]} /><meshStandardMaterial color="#faf6ee" roughness={0.85} /></mesh>
    {[[-0.09, 1.02, -0.3], [0.07, 1.09, 0.3], [0, 1.2, 0]].map(([x, y, angle], i) => <mesh key={i} position={[0.76 + x, y, -0.47]} rotation={[0, 0, angle]} scale={[0.055, 0.17, 0.025]}><sphereGeometry args={[1, 16, 12]} /><meshStandardMaterial color={i === 1 ? "#759d80" : "#568171"} roughness={0.9} /></mesh>)}
    <mesh position={[0, 0.71, -0.48]}><boxGeometry args={[3, 0.055, 0.45]} /><meshStandardMaterial color={accent} roughness={0.9} /></mesh>
  </group>;
}
function StudioLight() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new PMREMGenerator(gl), room = new RoomEnvironment();
    const environment = generator.fromScene(room, 0.04);
    scene.environment = environment.texture; scene.environmentIntensity = 0.65;
    room.dispose(); generator.dispose();
    return () => { scene.environment = null; environment.dispose(); };
  }, [gl, scene]);
  return <><hemisphereLight args={["#ffffff", "#d5dfed", 1]} /><directionalLight color="#ffffff" position={[-3, 4, 4]} intensity={0.85} /><directionalLight color="#eaf2ff" position={[2, 2, -1]} intensity={0.2} /></>;
}
function PortraitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const landscape = size.width / size.height > 1;
    camera.position.set(0, 1.54, landscape ? 1.7 : 2.1);
    camera.lookAt(0, landscape ? 1.48 : 1.41, 0);
  }, [camera, size.width, size.height]);
  return null;
}
class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function Character({ mouthLevel, phase, reducedMotion, onLoaded, onError }: Props & { onLoaded: () => void; onError: () => void }) {
  const [rig, setRig] = useState<ReturnType<typeof prepareVrm> | null>(null);
  const smoothMouth = useRef(0);
  useEffect(() => {
    let cancelled = false; let model: Object3D | undefined;
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    void loader.loadAsync(new URL("models/a-companion.vrm", new URL("./", window.location.href)).toString()).then(gltf => {
      if (cancelled) { VRMUtils.deepDispose(gltf.scene); return; }
      model = gltf.scene;
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error("Invalid VRM avatar");
      setRig(prepareVrm(vrm)); onLoaded();
    }).catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; if (model) VRMUtils.deepDispose(model); };
  }, [onLoaded, onError]);
  useFrame((state, delta) => {
    if (!rig) return;
    const time = state.clock.elapsedTime;
    const current = useConversationStore.getState();
    const speaking = phase === "speaking" && current.phase === "speaking";
    smoothMouth.current = updateVrmSpeech(rig.expressions, current.mouthLevel || mouthLevel, speaking, smoothMouth.current, delta);
    const blink = reducedMotion ? 0 : Math.max(0, 1 - Math.abs(time % 4.7 - 0.12) / 0.11);
    rig.expressions.setValue("blink", blink);
    if (rig.head && rig.headBase) {
      const x = reducedMotion ? 0 : phase === "thinking" ? -0.035 : Math.sin(time * 1.4) * (phase === "listening" ? 0.018 : 0.008);
      const y = reducedMotion ? 0 : Math.sin(time * 0.55) * 0.022 + (phase === "thinking" ? 0.07 : 0);
      rig.offset.setFromEuler(rig.euler.set(x, y, reducedMotion ? 0 : Math.sin(time * 0.65) * 0.012));
      rig.head.quaternion.copy(rig.headBase).multiply(rig.offset);
    }
    rig.scene.position.y = rig.baseY + (reducedMotion ? 0 : Math.sin(time * 1.7) * 0.002);
    rig.vrm.update(Math.min(delta, 0.05));
  });
  return rig ? <primitive object={rig.scene} /> : null;
}
export function Avatar3D(props: Props) {
  const [loaded, setLoaded] = useState(false); const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  const onLoaded = useCallback(() => setLoaded(true), []); const onError = useCallback(() => setFailed(true), []);
  const fallback = <div className="avatar-fallback"><div className="portrait-silhouette" /><strong>Mia</strong><span>3D 人物暂时不可用，仍可继续练习</span><button onClick={() => { setFailed(false); setLoaded(false); setAttempt(x => x + 1); }}>重新加载人物</button></div>;
  return <div className="avatar-canvas" role="img" aria-label="Mia，3D 英语陪练人物">
    {failed ? fallback : <RenderBoundary key={attempt} onError={onError} fallback={fallback}><Suspense fallback={null}>
      <Canvas dpr={props.quality === "low" ? 1 : [1, 1.5]} gl={{ antialias: props.quality === "standard", powerPreference: "high-performance", toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }} camera={{ position: [0, 1.51, 2.2], fov: 25 }} onCreated={({ camera, gl }) => { camera.lookAt(0, 1.4, 0); gl.domElement.addEventListener("webglcontextlost", onError, { once: true }); }}>
        <PortraitCamera /><StudioLight /><Room scenarioId={props.scenarioId} /><Character {...props} onLoaded={onLoaded} onError={onError} />
      </Canvas>
    </Suspense></RenderBoundary>}
    {!loaded && !failed && <div className="avatar-loading">正在准备 3D 陪练人物…</div>}
  </div>;
}
