import { useEffect, useRef, useState } from "react";
import { Avatar2D, characterOriginal } from "./Avatar2D";
import { PcmPlayer } from "../lib/audioPlayer";
import { useConversationStore as store } from "../store/conversation";

export default function AvatarPreview() {
  const [original, setOriginal] = useState(false), [blink, setBlink] = useState(0), [reduced, setReduced] = useState(false), [error, setError] = useState(""), [completed, setCompleted] = useState(0);
  const phase = store(state => state.phase);
  const player = useRef<PcmPlayer | null>(null), generation = useRef(0), cached = useRef<Uint8Array | null>(null);
  const playing = phase === "speaking" || phase === "starting";
  if (!player.current) player.current = new PcmPlayer(level => store.getState().setMouthLevel(level), () => store.getState().setPhase("idle"));
  const stop = () => { generation.current++; player.current?.stop(); store.getState().setPhase("idle"); };
  useEffect(() => () => { generation.current++; player.current?.close(); store.getState().reset(); }, []);
  async function speak() {
    const version = ++generation.current; setError(""); setOriginal(false); store.getState().setPhase("starting");
    try {
      await player.current!.prepare();
      if (!cached.current) {
        const response = await fetch(new URL("characters/preview-voice.wav", new URL("./", window.location.href)));
        if (!response.ok) throw Error("试听音频未能加载，请重试。");
        const decoder = new AudioContext({ sampleRate: 24000 });
        try {
          const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
          const samples = buffer.getChannelData(0), pcm = new Uint8Array(samples.length * 2), view = new DataView(pcm.buffer);
          for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
          cached.current = pcm;
        } finally { await decoder.close(); }
      }
      if (version !== generation.current) return;
      player.current!.start(); store.getState().setPhase("speaking"); player.current!.push(cached.current); player.current!.end();
    } catch (e) { if (version === generation.current) { stop(); setError(e instanceof Error ? e.message : "音频无法播放，请重试。"); } }
  }
  return <main className="original-preview">
    <header><strong>A · 2D 口语陪练预览</strong><span>原画局部表情切换 · 本地试听，不调用云接口</span></header>
    <div className={`original-preview-picture ${original ? "complete" : ""}`}>
      {original ? <img src={characterOriginal} alt="A 哑光版原始角色设定图" /> : <Avatar2D phase={phase} reducedMotion={reduced} blinkSignal={blink} completed={completed} />}
    </div>
    <div className="preview-state" role="status">{error || (phase === "speaking" ? "正在播放英文 · 嘴部跟随实际声音" : phase === "starting" ? "准备音频…" : phase === "listening" ? "聆听状态 · 眨眼更灵动" : phase === "thinking" ? "思考状态 · 短暂闭眼" : "自然状态 · 已闭嘴")}</div>
    <footer><button onClick={() => { stop(); setOriginal(false); }} aria-pressed={phase === "idle" && !original}>自然</button><button onClick={() => { stop(); setOriginal(false); store.getState().setPhase("listening"); }} aria-pressed={phase === "listening"}>聆听</button><button onClick={() => { stop(); setOriginal(false); store.getState().setPhase("thinking"); }} aria-pressed={phase === "thinking"}>思考</button><button onClick={() => { stop(); setOriginal(false); setCompleted(x => x + 1); }}>鼓励反馈</button><button onClick={() => { setOriginal(false); setBlink(x => x + 1); }} disabled={original}>眨眼一次</button><button onClick={() => void speak()} disabled={playing}>播放英文试听</button><button onClick={stop} disabled={!playing}>打断并闭嘴</button><button onClick={() => { stop(); setOriginal(x => !x); }} aria-pressed={original}>{original ? "返回半身" : "查看完整原图"}</button></footer>
    <label className="preview-motion"><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />减少动作（关闭自动眨眼与呼吸）</label>
  </main>;
}
