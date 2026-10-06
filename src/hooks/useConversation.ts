import { useCallback, useEffect, useRef } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { useConversationStore as store } from "../store/conversation";
import { getConversationUrl } from "../lib/api";
import { PcmPlayer } from "../lib/audioPlayer";
import { defaultPreferences, type Preferences, type Scenario, type Goal } from "../types";

function pcm(frame: Float32Array) {
  const values = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) values[i] = Math.round(Math.max(-1, Math.min(1, frame[i])) * 32767);
  return values.buffer;
}
interface Packet { type: string; session_id?: string; turn_id?: string; message_id?: string; text?: string; opening_line?: string; opening_translation?: string; suggested_phrase?: string; reply_en?: string; translation_zh?: string; correction?: string; audio?: string; message?: string; stage?: string; sample_rate?: number; progress?: Goal[] }

export function useConversation() {
  const socket = useRef<WebSocket | null>(null);
  const vad = useRef<MicVAD | null>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const capturing = useRef(false);
  const generation = useRef(0);
  const turn = useRef("");
  const cancellation = useRef<string | null>(null);
  const lastInput = useRef<{ id: string; text?: string; audio?: ArrayBuffer[] } | null>(null);
  const preferences = useRef<Preferences>(defaultPreferences);
  const preRoll = useRef<Float32Array[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef<(() => void) | null>(null);
  const currentMessage = useRef("");
  const chunks = useRef<Uint8Array[]>([]);
  const cache = useRef(new Map<string, Uint8Array[]>());
  const player = useRef<PcmPlayer | null>(null);
  const resumeRef = useRef<() => Promise<void>>(async () => {});
  if (!player.current) player.current = new PcmPlayer(level => store.getState().setMouthLevel(level), () => {
    if (!active.current) return;
    socket.current?.send(JSON.stringify({ type: "playback.complete", turn_id: turn.current }));
    void resumeRef.current();
  });
  const clearTimeoutRef = () => { if (timeout.current) clearTimeout(timeout.current); timeout.current = null; };
  const resume = useCallback(async () => {
    if (!active.current) return;
    const version = generation.current;
    busy.current = false; capturing.current = false; preRoll.current = []; clearTimeoutRef();
    const state = store.getState(); state.setPartial(""); state.setMouthLevel(0);
    if (vad.current && !state.microphoneError) {
      try { await vad.current.start(); if (active.current && version === generation.current) state.setPhase("listening"); }
      catch { state.setMicrophoneError("麦克风未能启动，可以继续文字练习；重新开始可重试。"); state.setPhase("text-ready"); }
    } else state.setPhase("text-ready");
  }, []);
  resumeRef.current = resume;
  const pause = () => { capturing.current = false; preRoll.current = []; void vad.current?.pause().catch(() => undefined); };
  const armTimeout = () => {
    clearTimeoutRef(); const version = generation.current; const id = turn.current;
    timeout.current = setTimeout(() => {
      if (active.current && generation.current === version && turn.current === id) {
        if (!store.getState().sessionId) {
          active.current = false; busy.current = false; socket.current?.close();
          store.getState().setPhase("error");
          store.getState().setError("连接超时，请重新开始练习。");
          return;
        }
        cancellation.current = id;
        socket.current?.send(JSON.stringify({ type: "turn.cancel", turn_id: id }));
        turn.current = ""; player.current?.stop();
        store.getState().setError("这轮等待超时，正在恢复连接。请重试或用文字输入。");
      }
    }, 45000);
  };
  const handle = (packet: Packet) => {
    const state = store.getState();
    if (packet.type === "session.ended") { stopped.current?.(); return; }
    if (!active.current) return;
    if (packet.session_id && state.sessionId && packet.session_id !== state.sessionId) return;
    if (packet.type === "session.ready") {
      clearTimeoutRef(); state.setSessionId(packet.session_id!); turn.current = packet.turn_id!;
      currentMessage.current = packet.message_id!;
      state.setProgress(packet.progress ?? []);
      state.addMessage({ id: packet.message_id, role: "assistant", text: packet.opening_line!, translation: packet.opening_translation, suggestedPhrase: packet.suggested_phrase });
      return;
    }
    if (packet.type === "turn.cancelled") {
      if (cancellation.current === null || packet.turn_id !== cancellation.current) return;
      cancellation.current = null; clearTimeoutRef(); void resume(); return;
    }
    if (packet.turn_id && packet.turn_id !== turn.current) return;
    if (packet.type === "transcript.partial") state.setPartial(packet.text ?? "");
    else if (packet.type === "transcript.final") { state.setPartial(""); if (lastInput.current?.id === packet.turn_id) lastInput.current = { id: packet.turn_id!, text: packet.text }; state.addMessage({ id: packet.message_id, role: "user", text: packet.text! }); }
    else if (packet.type === "assistant.transcribing") { state.setPhase("transcribing"); armTimeout(); }
    else if (packet.type === "assistant.processing") { state.setPhase("thinking"); armTimeout(); }
    else if (packet.type === "assistant.final") {
      state.setError(null); currentMessage.current = packet.message_id!;
      state.addMessage({ id: packet.message_id, role: "assistant", text: packet.reply_en!, translation: packet.translation_zh, correction: packet.correction, suggestedPhrase: packet.suggested_phrase });
    } else if (packet.type === "goals.updated") state.setProgress(packet.progress ?? []);
    else if (packet.type === "assistant.audio.start") { pause(); busy.current = true; chunks.current = []; player.current!.start(packet.sample_rate ?? 24000); armTimeout(); }
    else if (packet.type === "assistant.audio.chunk") {
      clearTimeoutRef(); state.setPhase("speaking");
      const bytes = Uint8Array.from(atob(packet.audio!), x => x.charCodeAt(0)); chunks.current.push(bytes); player.current!.push(bytes); armTimeout();
    } else if (packet.type === "assistant.audio.end") {
      clearTimeoutRef();
      if (chunks.current.length && currentMessage.current) cache.current.set(currentMessage.current, chunks.current);
      player.current!.end();
    } else if (packet.type === "error") {
      clearTimeoutRef(); capturing.current = false; player.current!.stop();
      state.setError(packet.message || "这轮未完成，请重试。");
      if (!state.sessionId) { active.current = false; busy.current = false; state.setPhase("error"); }
      else void resume();
    }
  };

  const start = useCallback(async (scenario?: Scenario, level = "A2", settings = defaultPreferences) => {
    if (active.current) return;
    const version = ++generation.current;
    preferences.current = settings; active.current = true; busy.current = true; cancellation.current = null; lastInput.current = null; turn.current = ""; cache.current.clear();
    store.getState().reset(); store.getState().setPhase("starting");
    try {
      const backend = await window.desktop?.startBackend();
      if (backend && backend.state !== "ready") throw new Error(backend.message);
      try { await player.current!.prepare(); } catch { /* text remains available if audio device cannot open */ }
      try {
        await vad.current?.destroy(); vad.current = null;
        const assetRoot = new URL("./", window.location.href).toString();
        const created = await MicVAD.new({
          model: "v5", startOnLoad: false, processorType: "AudioWorklet", baseAssetPath: assetRoot, onnxWASMBasePath: assetRoot,
          ortConfig: ort => { ort.env.wasm.wasmPaths = { mjs: new URL("ort-wasm-simd-threaded.mjs", assetRoot).toString(), wasm: new URL("ort-wasm-simd-threaded.wasm", assetRoot).toString() }; },
          getStream: () => navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.microphone ? { exact: settings.microphone } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
          positiveSpeechThreshold: 0.65, negativeSpeechThreshold: 0.4, redemptionMs: 900, minSpeechMs: 250, preSpeechPadMs: 240,
          onFrameProcessed: (_probabilities, frame) => {
            if (!active.current || busy.current || socket.current?.readyState !== WebSocket.OPEN) return;
            if (capturing.current) { const data = pcm(frame); socket.current.send(data); if (lastInput.current?.audio && lastInput.current.audio.length < 4000) lastInput.current.audio.push(data); }
            else { preRoll.current.push(frame.slice()); if (preRoll.current.length > 8) preRoll.current.shift(); }
          },
          onSpeechStart: () => {
            if (!active.current || busy.current || socket.current?.readyState !== WebSocket.OPEN) return;
            turn.current = crypto.randomUUID(); capturing.current = true; store.getState().setError(null);
            lastInput.current = { id: turn.current, audio: [] };
            socket.current.send(JSON.stringify({ type: "audio.start", turn_id: turn.current, sample_rate: 16000 }));
            for (const frame of preRoll.current) { const data = pcm(frame); socket.current.send(data); lastInput.current.audio!.push(data); } preRoll.current = [];
          },
          onSpeechEnd: () => {
            if (!capturing.current || !active.current || busy.current) return;
            busy.current = true; pause(); store.getState().setPhase("transcribing");
            socket.current?.send(JSON.stringify({ type: "audio.end", turn_id: turn.current })); armTimeout();
          },
          onVADMisfire: () => {
            if (capturing.current) { capturing.current = false; busy.current = true; pause(); cancellation.current = turn.current; socket.current?.send(JSON.stringify({ type: "turn.cancel", turn_id: turn.current })); turn.current = ""; }
          },
        });
        if (!active.current || version !== generation.current) { await created.destroy(); return; }
        vad.current = created;
      } catch { store.getState().setMicrophoneError("麦克风或语音检测不可用，可以使用文字输入继续；重新开始可重试。"); }
      if (!active.current || version !== generation.current) { await vad.current?.destroy(); vad.current = null; return; }
      const conversationUrl = await getConversationUrl();
      if (!active.current || version !== generation.current) return;
      const ws = new WebSocket(conversationUrl); socket.current = ws;
      armTimeout();
      ws.addEventListener("open", () => {
        if (version !== generation.current || !active.current) return ws.close();
        ws.send(JSON.stringify({ type: "session.start", scenario_id: scenario?.id ?? "cafe-ordering", level, options: { voice: settings.voice, rate: settings.rate } })); armTimeout();
      });
      ws.addEventListener("message", event => {
        if (socket.current !== ws || version !== generation.current) return;
        try { handle(JSON.parse(event.data) as Packet); } catch { store.getState().setError("收到无效的服务响应，请重新开始练习。"); }
      });
      ws.addEventListener("close", () => {
        if (socket.current !== ws || version !== generation.current || !active.current) return;
        active.current = false; busy.current = false; clearTimeoutRef(); pause(); player.current!.stop();
        store.getState().setSessionId(null); store.getState().setError("对话连接已断开，请重新开始练习。");
      });
    } catch (error) {
      if (version !== generation.current) return;
      active.current = false; busy.current = false; clearTimeoutRef();
      store.getState().setError(error instanceof Error ? error.message : "启动失败");
    }
  // Session callbacks deliberately refer to refs so cancelled generations cannot mutate a new session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const interrupt = useCallback(() => {
    if (!active.current) return;
    player.current!.stop(); pause(); busy.current = true; clearTimeoutRef();
    if (cancellation.current !== null) return;
    cancellation.current = turn.current;
    socket.current?.send(JSON.stringify({ type: "turn.cancel", turn_id: turn.current }));
    turn.current = ""; store.getState().setPhase("thinking");
  }, []);
  const stop = useCallback(async () => {
    const id = store.getState().sessionId;
    active.current = false; busy.current = false; cancellation.current = null; clearTimeoutRef(); pause(); player.current!.stop();
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise<void>(resolve => {
        const deadline = setTimeout(resolve, 4000);
        stopped.current = () => { clearTimeout(deadline); resolve(); };
        ws.send(JSON.stringify({ type: "session.stop" }));
      });
    }
    generation.current++; stopped.current = null; ws?.close(); socket.current = null;
    cache.current.clear(); chunks.current = []; lastInput.current = null;
    await vad.current?.destroy().catch(() => undefined); vad.current = null;
    store.getState().setSessionId(null); store.getState().setPhase("idle"); store.getState().setError(null); store.getState().setPartial("");
    return id;
  }, []);
  const submitText = useCallback((text: string) => {
    if (!text.trim() || busy.current || !active.current || !store.getState().sessionId || socket.current?.readyState !== WebSocket.OPEN) return false;
    busy.current = true; pause(); turn.current = crypto.randomUUID(); store.getState().setError(null); store.getState().setPhase("thinking");
    lastInput.current = { id: turn.current, text: text.trim() };
    socket.current.send(JSON.stringify({ type: "text.submit", turn_id: turn.current, text: text.trim() })); armTimeout(); return true;
  }, []);
  const retry = useCallback(() => {
    const input = lastInput.current;
    if (!input || !active.current || busy.current || !store.getState().sessionId || socket.current?.readyState !== WebSocket.OPEN) return false;
    busy.current = true; pause(); turn.current = input.id; store.getState().setError(null);
    if (input.text) {
      store.getState().setPhase("thinking"); socket.current.send(JSON.stringify({ type: "text.submit", turn_id: input.id, text: input.text }));
    } else if (input.audio?.length) {
      store.getState().setPhase("transcribing"); socket.current.send(JSON.stringify({ type: "audio.start", turn_id: input.id, sample_rate: 16000 }));
      const version = generation.current;
      void (async () => {
        for (const frame of input.audio!) {
          if (!active.current || generation.current !== version || turn.current !== input.id || socket.current?.readyState !== WebSocket.OPEN) return;
          socket.current.send(frame);
          await new Promise(resolve => setTimeout(resolve, frame.byteLength / 32));
        }
        if (active.current && turn.current === input.id) socket.current?.send(JSON.stringify({ type: "audio.end", turn_id: input.id }));
      })();
    } else { void resume(); return false; }
    armTimeout(); return true;
  }, []);
  const replay = useCallback((messageId: string) => {
    if (!active.current || busy.current || !store.getState().sessionId) return;
    pause(); busy.current = true; turn.current = crypto.randomUUID(); currentMessage.current = messageId;
    const audio = cache.current.get(messageId);
    if (audio) { player.current!.start(); store.getState().setPhase("speaking"); for (const chunk of audio) player.current!.push(chunk); player.current!.end(); }
    else { store.getState().setPhase("thinking"); socket.current?.send(JSON.stringify({ type: "assistant.replay", turn_id: turn.current, message_id: messageId })); armTimeout(); }
  }, []);
  useEffect(() => () => {
    active.current = false; generation.current++; clearTimeoutRef(); player.current!.close();
    socket.current?.close(); void vad.current?.destroy();
  }, []);
  return { start, stop, submitText, interrupt, replay, retry };
}
