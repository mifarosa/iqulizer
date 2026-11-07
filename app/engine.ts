import {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  BiquadFilterNode,
  GainNode,
  WaveShaperNode,
} from 'react-native-audio-api';

// Center frequencies of the 10 EQ bands (Hz).
export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Starting points only: every headphone is different, so tweak by ear.
export const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Budget fix': [4, 3, 0, -2, -1, 0, 1, -2, -3, 0],
  'Bass boost': [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  Vocal: [-2, -1, 0, 1, 3, 3, 2, 0, -1, -2],
  Bright: [0, 0, 0, 0, 0, 1, 2, 3, 4, 4],
};

// Soft-clip curve used as a limiter: linear below the knee, smoothly
// compressed above it, never exceeding 1.0.
function limiterCurve(size = 4096, knee = 0.7): Float32Array {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y =
      a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export class Engine {
  private ctx = new AudioContext();
  private filters: BiquadFilterNode[];
  private preamp: GainNode;
  private limiter: WaveShaperNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0; // context time when the current source started
  private offset = 0; // track position (s) at that moment
  playing = false;

  constructor() {
    // Keep playing with the screen locked / app in background.
    AudioManager.setSystemOptions({ ios: { category: 'playback' } });

    this.filters = BANDS.map((freq, i) => {
      const f = this.ctx.createBiquadFilter();
      f.type =
        i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.0;
      f.gain.value = 0;
      return f;
    });
    this.preamp = this.ctx.createGain();
    this.limiter = this.ctx.createWaveShaper();
    this.limiter.curve = limiterCurve();
    this.limiter.oversample = '2x';

    // filters -> preamp -> limiter -> speakers
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i].connect(this.filters[i + 1]);
    }
    this.filters[this.filters.length - 1].connect(this.preamp);
    this.preamp.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  position(): number {
    if (!this.playing) return this.offset;
    return Math.min(
      this.duration,
      this.offset + (this.ctx.currentTime - this.startedAt)
    );
  }

  setGains(gains: number[], autoPreamp: boolean) {
    gains.forEach((g, i) => {
      this.filters[i].gain.value = g;
    });
    // Cut the overall level by the largest boost so boosted bands can't clip.
    const peak = Math.max(0, ...gains);
    this.preamp.gain.value = autoPreamp ? Math.pow(10, -peak / 20) : 1;
  }

  async load(url: string) {
    this.stopSource();
    this.playing = false;
    this.offset = 0;
    this.buffer = null;
    // The whole track is downloaded and decoded before playback starts.
    this.buffer = await this.ctx.decodeAudioData(url);
  }

  async play() {
    if (!this.buffer || this.playing) return;
    await this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.filters[0]);
    src.start(0, this.offset);
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.stopSource();
    this.playing = false;
  }

  async seek(seconds: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.offset = Math.max(0, Math.min(seconds, this.duration));
    if (wasPlaying) await this.play();
  }

  private stopSource() {
    try {
      this.source?.stop();
    } catch {
      // Source may already have finished; nothing to do.
    }
    this.source = null;
  }
}
