// Sound for Golden Hour Ring Run, all of it synthesised with WebAudio —
// there are no audio files in this game. The engine is two detuned
// oscillators through a low-pass filter whose pitch and loudness follow
// the throttle; everything else is a small one-shot: a chime when a ring
// is threaded, a beeper for the stall warning, a splash or a thud when
// the flight ends badly, and a short rising figure for a good landing.
//
// Browsers will not start an AudioContext before a user gesture, so the
// engine creates its context lazily on the first start() call, which the
// game makes from the key press that begins a flight.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineNodes = null;
    this.stallNodes = null;
    this.windNodes = null;
  }

  // Create the context and the standing engine sound. Safe to call
  // again: later calls just make sure the context is running.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Engine: a sawtooth and a square an octave apart, detuned a few
    // cents, muffled by a low-pass so it reads as a small radial engine
    // rather than a synth lead.
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    oscA.start();
    oscB.start();
    this.engineNodes = { oscA, oscB, filter, gain };

    // Wind: a looped buffer of softened (brownish) noise through a
    // band-pass, silent until setWind gives it something to say. The
    // brownish tilt keeps it a rush of air rather than a hiss.
    const wlen = ctx.sampleRate * 2;
    const wbuf = ctx.createBuffer(1, wlen, ctx.sampleRate);
    const wdata = wbuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < wlen; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      wdata[i] = last * 3.2;
    }
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = wbuf;
    wsrc.loop = true;
    const wfilter = ctx.createBiquadFilter();
    wfilter.type = 'bandpass';
    wfilter.frequency.value = 480;
    wfilter.Q.value = 0.7;
    const wgain = ctx.createGain();
    wgain.gain.value = 0;
    wsrc.connect(wfilter);
    wfilter.connect(wgain);
    wgain.connect(ctx.destination);
    wsrc.start();
    this.windNodes = { filter: wfilter, gain: wgain };
  }

  // Airflow over the airframe: louder and higher as speed builds,
  // silent on the ground and when muted.
  setWind(speedNorm) {
    if (!this.ctx || !this.windNodes) return;
    const t = this.ctx.currentTime;
    const amt = Math.max(0, Math.min(1, speedNorm));
    this.windNodes.gain.gain.setTargetAtTime(this.muted ? 0 : amt * amt * 0.055, t, 0.15);
    this.windNodes.filter.frequency.setTargetAtTime(320 + amt * 620, t, 0.2);
  }

  // Follow the flight: throttle 0..1, plus the airspeed so a dive with
  // the throttle closed still winds the note up a little.
  setEngine(throttle, speedNorm) {
    if (!this.ctx || !this.engineNodes) return;
    const t = this.ctx.currentTime;
    const { oscA, oscB, filter, gain } = this.engineNodes;
    const base = 52 + throttle * 62 + speedNorm * 16;
    oscA.frequency.setTargetAtTime(base, t, 0.08);
    oscB.frequency.setTargetAtTime(base * 0.5 + 3, t, 0.08);
    filter.frequency.setTargetAtTime(300 + throttle * 700, t, 0.1);
    gain.gain.setTargetAtTime(this.muted ? 0 : 0.015 + throttle * 0.05, t, 0.09);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.engineNodes) {
      this.engineNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
    if (this.ctx && this.windNodes) {
      this.windNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
    if (m) this.setStall(false);
  }

  // A short sine blip with an exponential decay, the building block for
  // the chime and the landing figure.
  blip(freq, at, dur, vol, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + at;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Threading a ring: three bright notes climbing, and once a streak
  // is running (3+) a little triangle arpeggio on top to celebrate it.
  chime(streak = 1) {
    this.blip(1318, 0, 0.35, 0.12);
    this.blip(1975, 0.07, 0.45, 0.1);
    this.blip(2637, 0.13, 0.4, 0.05);
    if (streak >= 3) {
      this.blip(1568, 0.16, 0.3, 0.06, 'triangle');
      this.blip(2093, 0.22, 0.38, 0.06, 'triangle');
    }
  }

  // Skimming a ring's rim — close, but no score.
  nearMiss() {
    this.blip(660, 0, 0.15, 0.06, 'triangle');
  }

  // The stall warning: a square beeper switched by a slow LFO, started
  // and stopped by the flight model as the wing stalls and recovers.
  setStall(on) {
    if (!this.ctx) return;
    if (on && !this.stallNodes && !this.muted) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 940;
      const gate = ctx.createGain();
      gate.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.028;
      lfo.connect(lfoGain);
      lfoGain.connect(gate.gain);
      const base = ctx.createConstantSource();
      base.offset.value = 0.028;
      base.connect(gate.gain);
      osc.connect(gate);
      gate.connect(ctx.destination);
      osc.start();
      lfo.start();
      base.start();
      this.stallNodes = { osc, lfo, base, gate };
    } else if (!on && this.stallNodes) {
      const { osc, lfo, base } = this.stallNodes;
      try {
        osc.stop();
        lfo.stop();
        base.stop();
      } catch {
        /* already stopped */
      }
      this.stallNodes = null;
    }
  }

  // A burst of filtered noise, shaped per ending: a splash rings longer
  // and higher, a thud is short and low.
  noiseBurst(dur, freq, vol) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  splash() {
    this.noiseBurst(0.9, 1400, 0.22);
  }

  thud() {
    this.noiseBurst(0.35, 300, 0.3);
    this.blip(64, 0, 0.3, 0.22, 'sine');
  }

  // A good landing earns a small rising figure, now grounded on a low
  // note so the climb feels earned.
  fanfare() {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => this.blip(f, i * 0.11, 0.4, 0.1, 'triangle'));
  }

  // Silence the engine (title screen, crash, parked after landing).
  quiet() {
    if (this.ctx && this.engineNodes) {
      this.engineNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    if (this.ctx && this.windNodes) {
      this.windNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    this.setStall(false);
  }
}
