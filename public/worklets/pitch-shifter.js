// Осколок: pitch shift without changing speed. Two read heads sweep a short delay line at (1 − ratio) samples per
// sample and crossfade with sine windows half a window apart, so the pitch moves while the timing stays put.
class OskolokPitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    this.size = 8192; this.window = 2048; this.buffers = []; this.write = 0; this.phase = 0;
  }
  read(buffer, delay) {
    let p = this.write - delay - 1;
    while (p < 0) p += this.size;
    const i = Math.floor(p), f = p - i, a = buffer[i], b = buffer[(i + 1) % this.size];
    return a + (b - a) * f;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length) return true;
    const ratio = parameters.ratio[0], frames = input[0].length, W = this.window;
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.size));
    const bypass = Math.abs(ratio - 1) < 1e-4;
    for (let i = 0; i < frames; i++) {
      if (!bypass) { this.phase += 1 - ratio; if (this.phase >= W) this.phase -= W; else if (this.phase < 0) this.phase += W; }
      const d1 = this.phase, d2 = (this.phase + W / 2) % W;
      const g1 = Math.sin(Math.PI * d1 / W), g2 = Math.sin(Math.PI * d2 / W);
      for (let c = 0; c < output.length; c++) {
        const source = input[c] || input[0], buffer = this.buffers[c];
        buffer[this.write] = source[i];
        output[c][i] = bypass ? source[i] : this.read(buffer, d1) * g1 + this.read(buffer, d2) * g2;
      }
      this.write = (this.write + 1) % this.size;
    }
    return true;
  }
}
registerProcessor('oskolok-pitch-shifter', OskolokPitchShifter);
