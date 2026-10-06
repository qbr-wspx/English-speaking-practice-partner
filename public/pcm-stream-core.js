/** Continuous PCM queue. One resampling phase spans every network packet. */
export class PcmStream {
  constructor(outputRate, inputRate = 24000) {
    this.outputRate = outputRate; this.inputRate = inputRate;
    this.ring = new Float32Array(16384); this.fadeFrames = Math.ceil(outputRate * 0.004);
    this.last = 0; this.release = 0; this.reset();
  }
  reset() { this.read = 0; this.count = 0; this.phase = 0; this.gain = 0; this.waiting = true; this.ended = false; this.complete = false; this.active = false; this.underruns = 0; }
  start(rate = 24000) { this.reset(); this.inputRate = rate; this.active = true; this.release = 0; this.last = 0; }
  push(samples) {
    if (!this.active || this.ended) return;
    if (this.count + samples.length > this.ring.length) {
      let size = this.ring.length; while (size < this.count + samples.length) size *= 2;
      const next = new Float32Array(size);
      for (let i = 0; i < this.count; i++) next[i] = this.ring[(this.read + i) % this.ring.length];
      this.ring = next; this.read = 0;
    }
    const write = (this.read + this.count) % this.ring.length, first = Math.min(samples.length, this.ring.length - write);
    this.ring.set(samples.subarray(0, first), write); this.ring.set(samples.subarray(first), 0); this.count += samples.length;
  }
  end() { this.ended = true; }
  stop() { const last = this.last; this.reset(); this.last = last; this.release = this.fadeFrames; }
  render(output) {
    output.fill(0);
    const step = this.inputRate / this.outputRate, prefill = Math.ceil(this.inputRate * 0.15);
    for (let i = 0; i < output.length; i++) {
      if (!this.active) { if (this.release > 0) output[i] = this.last * (--this.release / this.fadeFrames); continue; }
      if (this.waiting) {
        if (this.count < prefill && !this.ended) continue;
        this.waiting = false; this.gain = 0;
      }
      if (this.count === 0 || (!this.ended && this.count < 2)) {
        if (this.ended) { this.active = false; this.complete = true; }
        else { this.waiting = true; this.underruns++; }
        this.gain = 0; this.last = 0; continue;
      }
      const a = this.ring[this.read], b = this.count > 1 ? this.ring[(this.read + 1) % this.ring.length] : a;
      // Only stream ends/real starvation get an envelope, never ordinary packet boundaries.
      const target = Math.min(1, Math.max(0, (this.count - this.phase - 1) / (this.inputRate * 0.004)));
      this.gain += Math.max(-1 / this.fadeFrames, Math.min(1 / this.fadeFrames, target - this.gain));
      this.last = (a + (b - a) * this.phase) * this.gain; output[i] = this.last;
      this.phase += step;
      const consume = Math.min(this.count, Math.floor(this.phase));
      this.read = (this.read + consume) % this.ring.length; this.count -= consume; this.phase -= consume;
    }
    return this.complete;
  }
}
