import { useEffect, useId, useRef, useState } from "react";
import { useConversationStore, type ConversationPhase } from "../store/conversation";
import { mouthIsOpen } from "../lib/avatar2dMotion";

const asset = (name: string) => new URL(`characters/${name}`, new URL("./", window.location.href)).href;
export const characterOriginal = asset("a-original-matte.png");
const blinkSource = asset("a-blink-source.png"), mouthSource = asset("a-mouth-source.png");

export function Avatar2D({ phase = "idle", reducedMotion = false, blinkSignal = 0, completed = 0 }: { phase?: ConversationPhase; reducedMotion?: boolean; blinkSignal?: number; completed?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [failed, setFailed] = useState(false), [ready, setReady] = useState(false), [expressions, setExpressions] = useState(false), [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null), mouth = useRef<SVGGElement>(null), eyes = useRef<SVGGElement>(null);
  const blinkNow = useRef(() => {});
  const [encouraging, setEncouraging] = useState(false);
  const previousCompleted = useRef(completed);
  useEffect(() => {
    if (completed <= previousCompleted.current) { previousCompleted.current = completed; return; }
    previousCompleted.current = completed;
    setEncouraging(true);
    const timeout = setTimeout(() => setEncouraging(false), reducedMotion ? 1200 : 2500);
    return () => clearTimeout(timeout);
  }, [completed, reducedMotion]);
  useEffect(() => {
    let cancelled = false;
    setReady(false); setExpressions(false); setFailed(false);
    const load = (src: string) => new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(); image.onerror = reject; image.src = src; });
    void load(characterOriginal).then(() => { if (!cancelled) setReady(true); }).catch(() => { if (!cancelled) setFailed(true); });
    void Promise.all([load(blinkSource), load(mouthSource)]).then(() => { if (!cancelled) setExpressions(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => {
    let opened = false;
    const update = () => {
      const current = useConversationStore.getState();
      opened = expressions && mouthIsOpen(current.mouthLevel, phase === "speaking" && current.phase === "speaking", opened);
      // Subscribe directly: stop() sets energy to zero synchronously, before the next React render.
      if (mouth.current) mouth.current.style.visibility = opened ? "visible" : "hidden";
      if (root.current) root.current.dataset.mouth = opened ? "open" : "closed";
    };
    update(); const unsubscribe = useConversationStore.subscribe(update);
    return () => { unsubscribe(); if (mouth.current) mouth.current.style.visibility = "hidden"; };
  }, [phase, expressions]);
  useEffect(() => {
    let next: ReturnType<typeof setTimeout>, reopen: ReturnType<typeof setTimeout>;
    const show = (closed: boolean) => {
      if (eyes.current) eyes.current.style.visibility = closed ? "visible" : "hidden";
      if (root.current) root.current.dataset.eyes = closed ? "closed" : "open";
    };
    const blink = () => { if (!expressions) return; clearTimeout(reopen); show(true); reopen = setTimeout(() => show(false), phase === "thinking" ? 320 : 125); };
    const schedule = () => { next = setTimeout(() => { if (!document.hidden) blink(); schedule(); }, (phase === "listening" ? 2200 : 3400) + Math.random() * 2500); };
    blinkNow.current = blink;
    if (expressions && !reducedMotion) schedule();
    return () => { clearTimeout(next); clearTimeout(reopen); show(false); blinkNow.current = () => {}; };
  }, [expressions, reducedMotion, phase]);
  useEffect(() => { if (blinkSignal) blinkNow.current(); }, [blinkSignal]);
  return <div ref={root} className="avatar-canvas avatar-2d" role="img" aria-label="A，2D 英语陪练人物" data-phase={phase} data-encouraging={encouraging} data-ready={ready && expressions} data-reduced-motion={reducedMotion}>
    {failed ? <div className="avatar-fallback"><span>人物图片暂时不可用，仍可继续练习</span><button onClick={() => setAttempt(x => x + 1)}>重新加载人物</button></div> : <>
      <svg className="avatar-original-portrait" viewBox="0 0 800 1040" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <defs>
          <filter id={`edge-${id}`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.2" /></filter>
          <mask id={`eyes-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1312" height="1199"><g fill="white" filter={`url(#edge-${id})`}><rect x="330" y="293" width="97" height="63" rx="15" /><rect x="477" y="247" width="92" height="65" rx="15" /></g></mask>
          <mask id={`mouth-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1312" height="1199"><rect x="437" y="377" width="72" height="45" rx="13" fill="white" filter={`url(#edge-${id})`} /></mask>
        </defs>
        <g className="avatar-breath">
          <image href={characterOriginal} width="1312" height="1199" />
          <g ref={eyes} className="avatar-eyes" style={{ visibility: "hidden" }}><image href={blinkSource} width="1312" height="1199" mask={`url(#eyes-${id})`} /></g>
          <g ref={mouth} className="avatar-mouth" style={{ visibility: "hidden" }}><image href={mouthSource} width="1312" height="1199" mask={`url(#mouth-${id})`} /></g>
        </g>
      </svg>
      <div className="avatar-presence" aria-hidden="true"><i /><i /><i /></div>
      {encouraging && <div className="avatar-encouragement" aria-hidden="true">✦</div>}
      {!ready && <div className="avatar-loading">正在准备 2D 陪练人物…</div>}
      {ready && !expressions && <button className="avatar-expression-retry" onClick={() => setAttempt(x => x + 1)}>表情准备中，点击可重新加载</button>}
    </>}
  </div>;
}
