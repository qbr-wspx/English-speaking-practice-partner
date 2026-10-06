/** PCM is consumed continuously on the audio thread, independent of UI/network packet timing. */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private preparing: Promise<void> | null = null;
  private epoch = 0;
  private carry: number | null = null;
  private completed = true;
  private rate = 24000;
  constructor(private mouth: (value: number) => void, private done: () => void) {}
  prepare(): Promise<void> {
    if (!this.preparing) this.preparing = this.prepareOnce().finally(() => { this.preparing = null; });
    return this.preparing;
  }
  private async prepareOnce() {
    const context = this.context ??= new AudioContext({ latencyHint: 'interactive', sampleRate: 24000 });
    if (!this.node) {
      await context.audioWorklet.addModule(new URL('pcm-player.worklet.js', new URL('./', window.location.href)).href);
      if (this.context !== context) return;
      const node = new AudioWorkletNode(context, 'lingo-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = ({ data }) => {
        if (this.node !== node || data.epoch !== this.epoch || this.completed) return;
        if (data.type === 'level') this.mouth(data.value);
        else if (data.type === 'done') this.complete();
      };
      node.connect(context.destination); this.node = node;
    }
    await context.resume();
  }
  start(sampleRate = 24000) {
    this.stop(); this.completed = false; this.rate = sampleRate;
    this.node?.port.postMessage({ type: 'start', epoch: this.epoch, sampleRate });
  }
  push(bytes: Uint8Array, sampleRate = this.rate) {
    if (!this.node || this.completed) return;
    if (sampleRate !== this.rate) throw new Error('音频采样率发生变化，请重试这一轮。');
    let input = bytes;
    if (this.carry !== null) { input = new Uint8Array(bytes.length + 1); input[0] = this.carry; input.set(bytes, 1); this.carry = null; }
    if (input.length % 2) { this.carry = input.at(-1)!; input = input.slice(0, -1); }
    if (!input.length) return;
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength), samples = new Float32Array(input.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    this.node.port.postMessage({ type: 'push', epoch: this.epoch, samples: samples.buffer }, [samples.buffer]);
  }
  end() { if (!this.node) this.complete(); else this.node.port.postMessage({ type: 'end', epoch: this.epoch }); }
  private complete() { if (this.completed) return; this.completed = true; this.mouth(0); this.done(); }
  stop() { this.epoch++; this.completed = true; this.carry = null; this.node?.port.postMessage({ type: 'stop', epoch: this.epoch }); this.mouth(0); }
  close() { this.stop(); this.node?.disconnect(); this.node = null; const context = this.context; this.context = null; void context?.close(); }
}
