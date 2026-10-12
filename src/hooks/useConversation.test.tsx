// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversation } from "./useConversation";
import { useConversationStore as store } from "../store/conversation";

const mocks = vi.hoisted(() => ({ create: vi.fn(), start: vi.fn(), pause: vi.fn(), destroy: vi.fn(), callbacks: null as any, player: null as any }));
vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: mocks.create } }));
vi.mock("../lib/api", () => ({ getConversationUrl: async () => "ws://localhost/ws?token=test" }));
vi.mock("../lib/audioPlayer", () => ({ PcmPlayer: class {
  prepare = vi.fn().mockResolvedValue(undefined); start = vi.fn(); push = vi.fn(); end = vi.fn(); stop = vi.fn(); close = vi.fn();
  constructor(public mouth: (n: number) => void, public done: () => void) { mocks.player = this; }
} }));
class TestSocket extends EventTarget {
  static OPEN = 1; static instances: TestSocket[] = [];
  readyState = 0; sent: (string | ArrayBuffer)[] = [];
  constructor() { super(); TestSocket.instances.push(this); }
  send(data: string | ArrayBuffer) { this.sent.push(data); if (typeof data === "string") { const kind = JSON.parse(data).type; if (kind === "session.stop") this.receive({ type: "session.ended" }); if (kind === "session.discard") this.receive({ type: "session.discarded" }); } }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  receive(packet: Record<string, unknown>) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) })); }
  events() { return this.sent.filter((x): x is string => typeof x === "string").map(x => JSON.parse(x)); }
}
describe("streaming conversation coordination", () => {
  let root: Root, container: HTMLDivElement, conversation: ReturnType<typeof useConversation>;
  function Harness() { conversation = useConversation(); return null; }
  async function receive(ws: TestSocket, packet: Record<string, unknown>) { await act(async () => { ws.receive({ session_id: "session", ...packet }); }); }
  async function begin() {
    await act(async () => { await conversation.start(); });
    const ws = TestSocket.instances.at(-1)!; await act(async () => { ws.open(); });
    await receive(ws, { type: "session.ready", turn_id: "opening", message_id: "opening-message", opening_line: "Welcome!", progress: [] });
    await receive(ws, { type: "assistant.audio.start", turn_id: "opening" });
    await receive(ws, { type: "assistant.audio.chunk", turn_id: "opening", audio: "AAA=" });
    await receive(ws, { type: "assistant.audio.end", turn_id: "opening" }); return ws;
  }
  async function playbackDone() { await act(async () => { mocks.player.done(); }); }
  async function text(ws: TestSocket, value: string) {
    let accepted = false; await act(async () => { accepted = conversation.submitText(value); });
    return { accepted, id: ws.events().filter(e => e.type === "text.submit").at(-1)?.turn_id };
  }
  beforeEach(async () => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("WebSocket", TestSocket);
    TestSocket.instances = []; mocks.start.mockReset().mockResolvedValue(undefined); mocks.pause.mockReset().mockResolvedValue(undefined); mocks.destroy.mockReset().mockResolvedValue(undefined);
    mocks.create.mockReset().mockImplementation(async options => { mocks.callbacks = options; return { start: mocks.start, pause: mocks.pause, destroy: mocks.destroy }; });
    store.getState().reset(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => { root.render(createElement(Harness)); });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("waits for actual playback completion before accepting another turn", async () => {
    const ws = await begin(); expect((await text(ws, "hello")).accepted).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled(); await playbackDone();
    const request = await text(ws, "hello"); expect(request.accepted).toBe(true); expect((await text(ws, "again")).accepted).toBe(false);
    await receive(ws, { type: "assistant.final", turn_id: request.id, message_id: "reply", reply_en: "Hello." }); expect((await text(ws, "again")).accepted).toBe(false);
    await receive(ws, { type: "assistant.audio.end", turn_id: request.id }); await playbackDone(); expect((await text(ws, "again")).accepted).toBe(true);
  });
  it("streams pre-roll and live PCM with partial subtitles without uploading end audio twice", async () => {
    const ws = await begin(); await playbackDone();
    await act(async () => { mocks.callbacks.onFrameProcessed({}, new Float32Array([0.2])); mocks.callbacks.onSpeechStart(); mocks.callbacks.onFrameProcessed({}, new Float32Array([0.5])); });
    const id = ws.events().find(e => e.type === "audio.start").turn_id;
    await receive(ws, { type: "transcript.partial", turn_id: id, text: "I would" }); expect(store.getState().partial).toBe("I would");
    await act(async () => { mocks.callbacks.onSpeechEnd(new Float32Array(16000)); });
    expect(ws.sent.filter(x => x instanceof ArrayBuffer)).toHaveLength(2); expect(ws.events().filter(e => e.type === "audio.end")).toHaveLength(1);
    await receive(ws, { type: "transcript.final", turn_id: id, message_id: "user", text: "I would like tea." }); expect(store.getState().partial).toBe(""); expect(store.getState().messages.at(-1)?.text).toContain("tea");
  });
  it("continually interrupts and rejects late audio, subtitles, and duplicate cancellation acknowledgements", async () => {
    const ws = await begin(); const pushes = mocks.player.push.mock.calls.length;
    await act(async () => { conversation.interrupt(); conversation.interrupt(); }); expect(ws.events().filter(e => e.type === "turn.cancel")).toHaveLength(1);
    await receive(ws, { type: "assistant.audio.chunk", turn_id: "opening", audio: "AAA=" }); expect(mocks.player.push).toHaveBeenCalledTimes(pushes);
    await receive(ws, { type: "turn.cancelled", turn_id: "opening" }); const next = await text(ws, "new"); expect(next.accepted).toBe(true);
    await receive(ws, { type: "turn.cancelled", turn_id: "opening" }); await receive(ws, { type: "transcript.partial", turn_id: "opening", text: "old" });
    expect(store.getState().phase).toBe("thinking"); expect(store.getState().partial).toBe(""); expect((await text(ws, "duplicate")).accepted).toBe(false);
  });
  it("pauses listening without ending the session and resumes microphone capture", async () => {
    const ws = await begin(); await playbackDone();
    expect(store.getState().phase).toBe("listening");
    await act(async () => { expect(conversation.pause()).toBe(true); });
    expect(store.getState().phase).toBe("paused"); expect(mocks.pause).toHaveBeenCalled();
    expect(ws.events().some(e => e.type === "session.stop" || e.type === "session.discard")).toBe(false);
    await act(async () => { expect(conversation.resume()).toBe(true); });
    expect(store.getState().phase).toBe("listening"); expect(mocks.start).toHaveBeenCalled();
  });
  it("cancels active speech when paused and waits for cancellation before resuming", async () => {
    const ws = await begin();
    await act(async () => { expect(conversation.pause()).toBe(true); });
    expect(store.getState().phase).toBe("paused"); expect(mocks.player.stop).toHaveBeenCalled();
    expect(ws.events().filter(e => e.type === "turn.cancel").at(-1)?.turn_id).toBe("opening");
    await act(async () => { expect(conversation.resume()).toBe(true); });
    expect(store.getState().phase).toBe("starting");
    await receive(ws, { type: "turn.cancelled", turn_id: "opening" });
    expect(store.getState().phase).toBe("listening");
  });
  it("replays cached audio without a new synthesis request", async () => {
    const ws = await begin(); await playbackDone(); await act(async () => conversation.replay("opening-message"));
    expect(mocks.player.push).toHaveBeenCalledTimes(2); expect(ws.events().some(e => e.type === "assistant.replay")).toBe(false);
    expect(store.getState().phase).toBe("speaking"); await playbackDone(); expect(store.getState().phase).toBe("listening");
  });
  it("remains usable with microphone permission denied and TTS failure", async () => {
    mocks.create.mockRejectedValue(new Error("denied")); const ws = await begin(); await playbackDone(); expect(store.getState().phase).toBe("text-ready"); expect(store.getState().microphoneError).toContain("文字");
    const request = await text(ws, "hello"); await receive(ws, { type: "error", turn_id: request.id, stage: "tts", message: "额度不足" });
    expect(store.getState().phase).toBe("text-ready"); expect((await text(ws, "retry")).accepted).toBe(true);
  });
  it("stops before restart and excludes all events from the previous socket", async () => {
    const old = await begin(); await act(async () => { await conversation.stop(); }); const current = await begin();
    await receive(old, { type: "assistant.final", turn_id: "opening", message_id: "old", reply_en: "Old reply" }); await receive(old, { type: "error", message: "Old error" });
    expect(current).not.toBe(old); expect(store.getState().messages).toHaveLength(1); expect(store.getState().phase).toBe("speaking");
  });
  it("discards a session before closing and clears playback immediately", async () => {
    const ws = await begin();
    await act(async () => { expect(await conversation.stop("discard")).toBe("session"); });
    expect(ws.events().filter(e => e.type === "session.discard")).toHaveLength(1);
    expect(ws.events().filter(e => e.type === "session.stop")).toHaveLength(0);
    expect(mocks.player.stop).toHaveBeenCalled();
    expect(store.getState().sessionId).toBeNull();
    expect(store.getState().messages).toHaveLength(0);
  });
  it("retries the original request ID and deduplicates persisted user input", async () => {
    const ws = await begin(); await playbackDone(); const request = await text(ws, "hello");
    await receive(ws, { type: "transcript.final", turn_id: request.id, message_id: "user", text: "hello" });
    await receive(ws, { type: "error", turn_id: request.id, message: "Network error" });
    await act(async () => { expect(conversation.retry()).toBe(true); });
    expect(ws.events().filter(e => e.type === "text.submit").map(e => e.turn_id)).toEqual([request.id, request.id]);
    await receive(ws, { type: "transcript.final", turn_id: request.id, message_id: "user", text: "hello" });
    expect(store.getState().messages.filter(m => m.role === "user")).toHaveLength(1);
  });
  it("recovers timed out requests only after cancellation and ignores foreign sessions", async () => {
    const ws = await begin(); await playbackDone(); const request = await text(ws, "hello"); await act(async () => { await vi.advanceTimersByTimeAsync(45001); });
    expect((await text(ws, "retry")).accepted).toBe(false); await receive(ws, { type: "turn.cancelled", turn_id: request.id }); expect((await text(ws, "retry")).accepted).toBe(true);
    await receive(ws, { type: "assistant.final", session_id: "foreign", message_id: "bad", reply_en: "wrong" }); expect(store.getState().messages.some(m => m.text === "wrong")).toBe(false);
  });
  it("cancels pending microphone initialization without opening a hidden session", async () => {
    let release: ((value: any) => void) | undefined;
    mocks.create.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await act(async () => {
      const starting = conversation.start();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(release).toBeDefined(); await conversation.stop();
      release!({ start: mocks.start, pause: mocks.pause, destroy: mocks.destroy }); await starting;
    });
    expect(TestSocket.instances).toHaveLength(0); expect(mocks.destroy).toHaveBeenCalled(); expect(store.getState().phase).toBe("idle");
  });
});
