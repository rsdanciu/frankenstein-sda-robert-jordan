// Shared Web Audio output for scene sounds (e.g. the synthesised birdsong in Ingolstadt).
// Nothing is loaded from files. The AudioContext is created on first use, which is always
// after the user has clicked something, so browsers allow it to play. The on/off choice
// is remembered in this browser and toggled from the HUD.

const STORAGE_KEY = 'frankenstein-sda:sound';
const MASTER_VOLUME = 0.5;

let ctx = null;
let master = null;
let enabled = readPreference();
const listeners = new Set();

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const sound = {
  get enabled() {
    return enabled;
  },

  setEnabled(on) {
    enabled = Boolean(on);
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    if (master) master.gain.setTargetAtTime(enabled ? MASTER_VOLUME : 0, ctx.currentTime, 0.05);
    for (const fn of listeners) fn(enabled);
  },

  toggle() {
    this.setEnabled(!enabled);
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** The shared AudioContext, or null when sound is off or Web Audio is unavailable. */
  context() {
    if (!enabled) return null;
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  },

  /** Node every sound connects to (exists once context() has returned a context). */
  get output() {
    return master;
  },
};
