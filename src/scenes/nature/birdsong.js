import { sound } from '../../core/audio.js';

/**
 * Synthesised songbird phrases (Web Audio, no sound files): runs of quick whistles,
 * slides and trills built from sine tones with a little frequency wobble.
 *
 *   const phrase = composePhrase(rng, voice)  // → { notes: [{ t, dur }], duration }
 *   playPhrase(phrase, { pan })               // schedules it now; silent when sound is off
 *
 * The note timings are returned so a bird's beak can open in time with them.
 */

export function voiceFor(rng) {
  return { base: rng.float(2700, 4100), range: rng.float(0.25, 0.5), speed: rng.float(0.85, 1.2) };
}

export function composePhrase(rng, voice) {
  const notes = [];
  let t = 0;
  const figures = rng.int(2, 4);
  for (let f = 0; f < figures; f++) {
    const kind = rng.pick(['slide', 'slide', 'trill', 'whistle']);
    if (kind === 'trill') {
      const n = rng.int(3, 7);
      const fq = voice.base * rng.float(0.9, 1.35);
      for (let i = 0; i < n; i++) {
        const dur = 0.035 / voice.speed;
        notes.push({ t, dur, f0: fq * 1.08, f1: fq * 0.92, wobble: 0, gain: 0.16 });
        t += dur + 0.022 / voice.speed;
      }
    } else if (kind === 'whistle') {
      const dur = rng.float(0.16, 0.3) / voice.speed;
      const fq = voice.base * rng.float(1.1, 1.5);
      notes.push({ t, dur, f0: fq, f1: fq * rng.float(0.94, 1.04), wobble: rng.float(20, 45), gain: 0.12 });
      t += dur + 0.05;
    } else {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const dur = rng.float(0.06, 0.12) / voice.speed;
        const hi = voice.base * (1 + voice.range * rng.float(0.2, 1));
        const lo = voice.base * (1 - voice.range * rng.float(0, 0.5));
        const up = rng.chance(0.4);
        notes.push({ t, dur, f0: up ? lo : hi, f1: up ? hi : lo, wobble: rng.float(0, 30), gain: 0.15 });
        t += dur + rng.float(0.02, 0.06) / voice.speed;
      }
    }
    t += rng.float(0.06, 0.16);
  }
  return { notes, duration: t };
}

export function playPhrase(phrase, { pan = 0, volume = 1 } = {}) {
  const ctx = sound.context();
  if (!ctx || !sound.output) return false;
  const start = ctx.currentTime + 0.03;
  const out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (out.pan) out.pan.value = Math.max(-1, Math.min(1, pan));
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  hp.connect(out);
  out.connect(sound.output);
  for (const n of phrase.notes) {
    const t0 = start + n.t;
    const t1 = t0 + n.dur;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(50, n.f1), t1);
    if (n.wobble) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = n.wobble;
      depth.gain.value = n.f0 * 0.03;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t1 + 0.02);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(n.gain * volume, t0 + Math.min(0.012, n.dur * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(env).connect(hp);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
  const end = start + phrase.duration + 0.2;
  setTimeout(() => out.disconnect(), (end - ctx.currentTime) * 1000 + 100);
  return true;
}
