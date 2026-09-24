// WebAudio synth — every sound is generated at play time, no asset files.
// The AudioContext is created lazily, from inside a user-gesture handler
// (browser autoplay rules forbid creating one before a gesture); call
// ensureAudioContext() directly from a pointerdown/keydown listener.
//
// Voices: at most MAX_VOICES play at once; a new, louder voice steals the
// slot from the current quietest one, a quieter new voice is just dropped.

import type { MaterialId } from '../game/materials';
import { impactToVolume, impactToPitch } from './mapping';

const MAX_VOICES = 8;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let noiseBuffer: AudioBuffer | null = null;

interface Voice {
  gain: GainNode;
  volume: number;
  stopAt: number; // AudioContext time this voice is done and its slot can be reused
}
const voices: Voice[] = [];

/** Call from inside a user-gesture event handler. No-op after the first successful call, and where WebAudio is unavailable. */
export function ensureAudioContext(): void {
  if (ctx) return;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 1;
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setMuted(m: boolean): void {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 1;
}

export function isMuted(): boolean {
  return muted;
}

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 1);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** Reserves a voice slot for `volume`, playing for about `durationS`. Returns null if 8 louder voices are already active (caller should skip playing). */
function allocVoice(c: AudioContext, dest: GainNode, volume: number, durationS: number): GainNode | null {
  const now = c.currentTime;
  for (let i = voices.length - 1; i >= 0; i--) {
    if (voices[i].stopAt <= now) voices.splice(i, 1);
  }
  if (voices.length >= MAX_VOICES) {
    let quietest = 0;
    for (let i = 1; i < voices.length; i++) if (voices[i].volume < voices[quietest].volume) quietest = i;
    if (voices[quietest].volume >= volume) return null;
    voices[quietest].gain.disconnect();
    voices.splice(quietest, 1);
  }
  const gain = c.createGain();
  gain.connect(dest);
  voices.push({ gain, volume, stopAt: now + durationS });
  return gain;
}

const randomPitch = (): number => 1 + (Math.random() * 0.1 - 0.05); // +-5%

function envGain(c: AudioContext, g: GainNode, t: number, peak: number, decayDuration: number, attack = 0.002): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decayDuration);
}

function playNoise(
  c: AudioContext,
  dest: GainNode,
  t: number,
  duration: number,
  peak: number,
  filterType: BiquadFilterType,
  filterFreq: number,
  q = 1,
): void {
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const g = c.createGain();
  envGain(c, g, t, peak, duration);
  src.connect(filter).connect(g).connect(dest);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function playTone(
  c: AudioContext,
  dest: GainNode,
  t: number,
  freq: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine',
): OscillatorNode {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = c.createGain();
  envGain(c, g, t, peak, duration);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + duration + 0.05);
  return osc;
}

/** Plays this material's impact sound, volume/pitch scaled from `force` (Newtons). No-op if muted, no gesture yet, or the force is too small to hear. */
export function playImpactSound(material: MaterialId, force: number): void {
  if (!ctx || !masterGain || muted) return;
  const c = ctx;
  const dest = masterGain;
  const volume = impactToVolume(force);
  if (volume <= 0) return;
  const pMul = impactToPitch(force) * randomPitch();
  const t = c.currentTime;

  switch (material) {
    case 'wood': {
      const g = allocVoice(c, dest, volume, 0.2);
      if (!g) return;
      playNoise(c, g, t, 0.08, volume * 0.5, 'bandpass', 1200 * pMul, 1.2);
      playTone(c, g, t, 220 * pMul, 0.14, volume * 0.8, 'triangle');
      break;
    }
    case 'stone': {
      const g = allocVoice(c, dest, volume, 0.45);
      if (!g) return;
      playTone(c, g, t, 70 * pMul, 0.35, volume, 'sine');
      playNoise(c, g, t, 0.2, volume * 0.4, 'lowpass', 500 * pMul, 0.8);
      break;
    }
    case 'jelly': {
      const g = allocVoice(c, dest, volume, 0.35);
      if (!g) return;
      const osc = playTone(c, g, t, 180 * pMul, 0.28, volume, 'sine');
      osc.frequency.exponentialRampToValueAtTime(420 * pMul, t + 0.18);
      const lfo = c.createOscillator();
      lfo.frequency.value = 18;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 14;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + 0.3);
      break;
    }
    case 'glass': {
      const g = allocVoice(c, dest, volume, 0.3);
      if (!g) return;
      const freqs = [2200, 3100, 3900];
      freqs.forEach((f, i) => {
        playTone(c, g, t, f * pMul * (0.97 + Math.random() * 0.06), 0.16 + i * 0.02, volume * (0.6 / (i + 1)), 'sine');
      });
      break;
    }
  }
}

/** Sharp click, played when a glass piece cracks. */
export function playGlassCrackSound(): void {
  if (!ctx || !masterGain || muted) return;
  const c = ctx;
  const g = allocVoice(c, masterGain, 0.6, 0.1);
  if (!g) return;
  playNoise(c, g, c.currentTime, 0.04, 0.6, 'highpass', 4000, 1.5);
}

/** Bright noise burst + several random tinkles, played when a glass piece shatters. */
export function playGlassShatterSound(): void {
  if (!ctx || !masterGain || muted) return;
  const c = ctx;
  const dest = masterGain;
  const g = allocVoice(c, dest, 1, 0.5);
  if (!g) return;
  const t = c.currentTime;
  playNoise(c, g, t, 0.25, 0.9, 'highpass', 2500, 1);
  const tinkles = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < tinkles; i++) {
    const delay = Math.random() * 0.25;
    playTone(c, g, t + delay, 2000 + Math.random() * 3000, 0.12, 0.3, 'sine');
  }
}
