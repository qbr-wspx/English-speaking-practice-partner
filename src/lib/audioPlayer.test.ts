import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PcmPlayer } from "./audioPlayer";
class Context {
  destination = {}; audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined); close = vi.fn().mockResolvedValue(undefined);
}
class Node {
  static instance: Node;
  port = { postMessage: vi.fn(), onmessage: null as any }; connect = vi.fn(); disconnect = vi.fn();
  constructor() { Node.instance = this; }
  event(data: object) { this.port.onmessage({ data }); }
}
describe("continuous PCM transport", () => {
  beforeEach(() => { vi.stubGlobal("window", { location: { href: "http://localhost/" } }); vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Node); });
  afterEach(() => vi.unstubAllGlobals());
  it("joins odd bytes without changing the source samples and waits for audio-thread completion", async () => {
    const done=vi.fn(),mouth=vi.fn(),player=new PcmPlayer(mouth,done);await player.prepare();player.start();
    player.push(new Uint8Array([255]));player.push(new Uint8Array([127,0,128]));player.end();
    const messages=Node.instance.port.postMessage.mock.calls.map(call=>call[0]);
    const packet=messages.find(m=>m.type==='push');expect(Array.from(new Float32Array(packet.samples))).toEqual([32767/32768,-1]);
    expect(done).not.toHaveBeenCalled();Node.instance.event({type:'done',epoch:packet.epoch});expect(done).toHaveBeenCalledTimes(1);expect(mouth).toHaveBeenLastCalledWith(0);
  });
  it("ignores all stale mouth/completion events after stop or restart", async () => {
    const done=vi.fn(),mouth=vi.fn(),player=new PcmPlayer(mouth,done);await player.prepare();player.start();
    const old=Node.instance.port.postMessage.mock.calls.at(-1)![0].epoch;
    player.stop();expect(mouth).toHaveBeenLastCalledWith(0);player.start();
    Node.instance.event({type:'level',epoch:old,value:1});Node.instance.event({type:'done',epoch:old});expect(mouth).toHaveBeenLastCalledWith(0);expect(done).not.toHaveBeenCalled();
    const current=Node.instance.port.postMessage.mock.calls.at(-1)![0].epoch;Node.instance.event({type:'level',epoch:current,value:.5});expect(mouth).toHaveBeenLastCalledWith(.5);
  });
});
