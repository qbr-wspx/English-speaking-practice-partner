import { PcmStream } from './pcm-stream-core.js';
class LingoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.stream = new PcmStream(sampleRate); this.epoch = 0; this.frames = 0; this.sum = 0; this.reported = true;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') { this.epoch = data.epoch; this.stream.start(data.sampleRate); this.reported = false; this.frames = 0; this.sum = 0; }
      else if (data.type === 'stop') { this.epoch = data.epoch; this.stream.stop(); this.reported = true; this.frames = 0; this.sum = 0; }
      else if (data.epoch === this.epoch && data.type === 'push') this.stream.push(new Float32Array(data.samples));
      else if (data.epoch === this.epoch && data.type === 'end') this.stream.end();
    };
  }
  process(_inputs, outputs) {
    const channel = outputs[0]?.[0]; if (!channel) return true;
    const done = this.stream.render(channel);
    if (!this.reported) {
      for (const value of channel) this.sum += value * value;
      this.frames += channel.length;
      if (this.frames >= sampleRate * 0.02) {
        this.port.postMessage({ type: 'level', epoch: this.epoch, value: Math.min(1, Math.sqrt(this.sum / this.frames) * 6) }); this.frames = 0; this.sum = 0;
      }
      if (done) { this.reported = true; this.port.postMessage({ type: 'done', epoch: this.epoch, underruns: this.stream.underruns }); }
    }
    return true;
  }
}
registerProcessor('lingo-pcm', LingoPcmProcessor);
