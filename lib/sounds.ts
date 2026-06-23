"use client";

let audioUnlocked = false;
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioContext;
}

export function unlockAudio() {
  if (audioUnlocked) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    audioUnlocked = true;
  } catch {
    // Silent fail
  }
}

function playTone(frequency: number, duration: number, type: OscillatorType = "square") {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Silent fail
  }
}

export function playBuzz() {
  playTone(440, 0.15, "square");
  setTimeout(() => playTone(880, 0.15, "square"), 100);
}

export function playCorrect() {
  playTone(523, 0.12, "sine");
  setTimeout(() => playTone(659, 0.12, "sine"), 100);
  setTimeout(() => playTone(784, 0.2, "sine"), 200);
}

export function playIncorrect() {
  playTone(200, 0.3, "sawtooth");
}

export function playTick() {
  playTone(800, 0.05, "sine");
}

export function playOpen() {
  playTone(600, 0.1, "sine");
  setTimeout(() => playTone(900, 0.15, "sine"), 80);
}
