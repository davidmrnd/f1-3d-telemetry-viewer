import type { EngineCommand } from "./engine-telemetry";

declare const AudioWorkletProcessor: new () => { readonly port: MessagePort };
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

const TABLE_SIZE = 1024;
const BANK_DELAY_SECONDS = .00042;
const SHIFT_DURATION = 0.09;
const SHIFT_IMPACT_HZ = 185;
const TARGET_TIMEOUT = sampleRate * 0.3;

function wave(orders: readonly [order: number, gain: number, phase: number][]) {
  return Float32Array.from({ length: TABLE_SIZE + 1 }, (_, index) => {
    const angle = index / TABLE_SIZE * 4 * Math.PI;
    return orders.reduce((sum, [order, gain, phase]) => sum + gain * Math.sin(angle * order + phase), 0);
  });
}

const BANK_PULSE = wave([
  [1.5, .67, 1.1], [3, .54, .8], [4.5, .31, .46], [6, .29, .13],
  [7.5, .18, -.24], [9, .15, -.62], [10.5, .09, -.98], [12, .065, -1.35],
]);
const CRANK = wave([[.5, .08, .5], [1, .32, -.4], [2, .18, .6], [2.5, .09, 1.3]]);
const INTAKE = wave([[4.5, .13, .5], [6, .16, -.7], [9, .20, -1], [12, .13, -1.6]]);

function sampleWave(table: Float32Array, phase: number) {
  const index = phase * TABLE_SIZE;
  const lower = Math.floor(index);
  return table[lower] + (table[lower + 1] - table[lower]) * (index - lower);
}

function follow(seconds: number) {
  return 1 - Math.exp(-1 / (seconds * sampleRate));
}

const RPM_RISE = follow(.11);
const RPM_FALL = follow(.063);
const RPM_LIFT = follow(.038);
const RPM_SHIFT = follow(.023);
const PEDAL = follow(.032);
const FADE_IN = follow(.018);
const FADE_OUT = follow(.006);
const OVERRUN_DECAY = 1 - follow(.24);
const CRACKLE_DECAY = 1 - follow(.009);
const NOISE_FILTER = follow(.00018);

class EngineProcessor extends AudioWorkletProcessor {
  private target: EngineCommand = null;
  private targetAge = 0;
  private resync = true;
  private level = 0;
  private phase = 0;
  private rpmAudio = 0;
  private throttle = 0;
  private brake = 0;
  private shift = 0;
  private shiftTime = SHIFT_DURATION;
  private overrun = 0;
  private crackle = 0;
  private filteredNoise = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<EngineCommand>) => {
      if (!this.target || !data || data.reset) {
        this.resync = true;
        this.shiftTime = SHIFT_DURATION;
        this.overrun = 0;
        this.crackle = 0;
      } else if (data.shift && !this.resync) {
        this.shift = data.shift;
        this.shiftTime = 0;
      }
      this.target = data;
      this.targetAge = 0;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0][0];
    if (!output) return true;
    const target = this.targetAge < TARGET_TIMEOUT ? this.target : null;
    this.targetAge += output.length;
    if (!target) {
      this.target = null;
      if (this.level < .0001) return true;
    }

    for (let i = 0; i < output.length; i++) {
      if (this.resync && target && this.level < .012) {
        this.rpmAudio = target.rpmTarget;
        this.throttle = target.throttle;
        this.brake = target.brake;
        this.resync = false;
      }

      if (target && !this.resync) {
        let inertia = this.throttle < .24 ? RPM_LIFT : RPM_FALL;
        if (target.rpmTarget > this.rpmAudio) inertia = RPM_RISE;
        if (this.shiftTime < SHIFT_DURATION) inertia = RPM_SHIFT;
        this.rpmAudio += (target.rpmTarget - this.rpmAudio) * inertia;
        this.overrun = Math.max(this.overrun * OVERRUN_DECAY, this.throttle - target.throttle);
        this.throttle += (target.throttle - this.throttle) * PEDAL;
        this.brake += (target.brake - this.brake) * PEDAL;
        this.level += (1 - this.level) * FADE_IN;
      } else {
        this.level -= this.level * FADE_OUT;
      }

      const cut = Math.max(0, 1 - this.shiftTime / SHIFT_DURATION) * Math.min(1, this.shiftTime / .004);
      this.shiftTime += 1 / sampleRate;
      const pitchDip = this.shift > 0 ? .075 : .028;
      const cycleHz = this.rpmAudio * (1 - cut * pitchDip) / 120;
      this.phase += cycleHz / sampleRate;
      this.phase -= Math.floor(this.phase);
      const delayedBankPhase = this.phase + 1 - 1 / 6 - cycleHz * BANK_DELAY_SECONDS;

      const load = this.throttle * (1 - .45 * this.brake);
      const noise = Math.random() * 2 - 1;
      this.filteredNoise += (noise - this.filteredNoise) * NOISE_FILTER;
      const bankA = sampleWave(BANK_PULSE, this.phase);
      const bankB = sampleWave(BANK_PULSE, delayedBankPhase - Math.floor(delayedBankPhase));
      const exhaust = (bankA + .73 * bankB) * (.14 + .43 * load);
      const vibration = sampleWave(CRANK, this.phase) * (.19 + .39 * load);
      const intake = sampleWave(INTAKE, this.phase) * (.018 + .18 * load ** 2);
      const air = this.filteredNoise * (.008 + .019 * load);

      const overrun = Math.max(0, .32 - this.throttle) * (this.overrun + .65 * this.brake);
      if (target && !this.resync && this.rpmAudio > 5800 && Math.random() < 105 * overrun / sampleRate) {
        this.crackle = Math.max(this.crackle, .18 + .42 * overrun);
      }
      this.crackle *= CRACKLE_DECAY;
      const pops = .20 * this.crackle * (this.filteredNoise * 1.4 + exhaust * .4);
      const shiftImpact = cut > 0
        ? cut ** 6 * (.072 * Math.sin(2 * Math.PI * SHIFT_IMPACT_HZ * this.shiftTime) + .11 * this.filteredNoise)
        : 0;
      const signal = (exhaust + vibration + intake + air) * (1 - .68 * cut) + pops + shiftImpact;
      output[i] = this.level * .85 * signal / (1 + .5 * Math.abs(signal));
    }
    return true;
  }
}

registerProcessor("f1-engine", EngineProcessor);
