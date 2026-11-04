// Procedural WebAudio: engine, tyres, siren, hacks, alarms, ambience.
// Everything synthesized — no audio files.
import * as THREE from 'three';
import type { Vehicle } from '../vehicles/vehicle';

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private sfx!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  // continuous voices
  private engO1!: OscillatorNode;
  private engO2!: OscillatorNode;
  private engF!: BiquadFilterNode;
  private engG!: GainNode;
  private tyreG!: GainNode;
  private sirenO!: OscillatorNode;
  private sirenG!: GainNode;
  private sirenLfo!: OscillatorNode;
  private ambG!: GainNode;
  private alarmG!: GainNode;
  private alarmO!: OscillatorNode;
  private alarmUntil = 0;
  private carAlarms: Vehicle[] = [];
  private carAlarmG!: GainNode;
  private carAlarmO!: OscillatorNode;
  private hornT = 0;
  listener = new THREE.Vector3();

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const C = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = (this.ctx = new C());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // noise buffer
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.engO1 = ctx.createOscillator(); this.engO1.type = 'sawtooth';
    this.engO2 = ctx.createOscillator(); this.engO2.type = 'square';
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 400; this.engF.Q.value = 3;
    this.engG = ctx.createGain(); this.engG.gain.value = 0;
    const e2 = ctx.createGain(); e2.gain.value = 0.5;
    this.engO1.connect(this.engF); this.engO2.connect(e2).connect(this.engF);
    this.engF.connect(this.engG).connect(this.master);
    this.engO1.start(); this.engO2.start();
    // tyres
    const tn = this.noiseSrc(true);
    const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1400; tf.Q.value = 6;
    this.tyreG = ctx.createGain(); this.tyreG.gain.value = 0;
    tn.connect(tf).connect(this.tyreG).connect(this.master);
    // siren
    this.sirenO = ctx.createOscillator(); this.sirenO.type = 'square'; this.sirenO.frequency.value = 900;
    this.sirenLfo = ctx.createOscillator(); this.sirenLfo.frequency.value = 0.35;
    const lfoG = ctx.createGain(); lfoG.gain.value = 320;
    this.sirenLfo.connect(lfoG).connect(this.sirenO.frequency);
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
    this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    this.sirenO.connect(sf).connect(this.sirenG).connect(this.master);
    this.sirenO.start(); this.sirenLfo.start();
    // ambience: low city rumble
    const an = this.noiseSrc(true);
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 320;
    this.ambG = ctx.createGain(); this.ambG.gain.value = 0.12;
    an.connect(af).connect(this.ambG).connect(this.master);
    // bank alarm bell
    this.alarmO = ctx.createOscillator(); this.alarmO.type = 'square'; this.alarmO.frequency.value = 880;
    this.alarmG = ctx.createGain(); this.alarmG.gain.value = 0;
    const alf = ctx.createBiquadFilter(); alf.type = 'lowpass'; alf.frequency.value = 2500;
    this.alarmO.connect(alf).connect(this.alarmG).connect(this.master);
    this.alarmO.start();
    // car alarm
    this.carAlarmO = ctx.createOscillator(); this.carAlarmO.type = 'sawtooth'; this.carAlarmO.frequency.value = 700;
    this.carAlarmG = ctx.createGain(); this.carAlarmG.gain.value = 0;
    const caf = ctx.createBiquadFilter(); caf.type = 'lowpass'; caf.frequency.value = 1800;
    this.carAlarmO.connect(caf).connect(this.carAlarmG).connect(this.master);
    this.carAlarmO.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private noiseSrc(loop: boolean) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    s.start();
    return s;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  private att(pos?: THREE.Vector3, range = 80) {
    if (!pos) return 1;
    return Math.max(0, 1 - pos.distanceTo(this.listener) / range);
  }

  // ---- one-shots
  hackOn() { this.tone('sine', 300, 900, 0.18, 0.08); }
  hackBlip() { this.tone('square', 600, 1800, 0.12, 0.12); this.tone('square', 1200, 2400, 0.1, 0.06, 0.07); this.noise(0.15, 0.08, 3000, 'highpass'); }
  deny() { this.tone('square', 220, 160, 0.15, 0.08); }
  unlock() { this.tone('square', 500, 500, 0.05, 0.1); this.tone('square', 800, 800, 0.08, 0.1, 0.08); this.noise(0.1, 0.15, 1200, 'bandpass', 0.15); }
  powerDown() {
    this.tone('sawtooth', 380, 30, 1.4, 0.25);
    this.tone('sine', 120, 25, 1.6, 0.35);
    this.noise(0.6, 0.3, 900, 'lowpass');
    for (let i = 0; i < 6; i++) this.noise(0.05, 0.15, 4000, 'highpass', 0.1 + i * 0.12 + Math.random() * 0.05);
  }
  pop() { this.noise(0.25, 0.35, 2500, 'highpass'); this.tone('square', 1400, 200, 0.2, 0.08); }
  thud(v = 1, pos?: THREE.Vector3) { const a = this.att(pos) * v; if (a < 0.02) return; this.noise(0.25, 0.5 * a, 300); this.tone('sine', 90, 40, 0.25, 0.4 * a); }
  crash(impact: number, pos?: THREE.Vector3) {
    const a = this.att(pos, 120) * Math.min(1, impact / 18);
    if (a < 0.02) return;
    this.noise(0.4, 0.7 * a, 600);
    this.noise(0.3, 0.35 * a, 3500, 'highpass', 0.02);
    this.tone('sine', 70, 30, 0.35, 0.5 * a);
  }
  door() { this.noise(0.08, 0.2, 800, 'bandpass'); this.tone('sine', 140, 90, 0.1, 0.15, 0.03); }
  whoosh() { this.noise(0.25, 0.12, 900, 'bandpass'); }
  scream(pos?: THREE.Vector3) {
    const a = this.att(pos, 45);
    if (a < 0.05) return;
    const f = 520 + Math.random() * 260;
    this.tone('sawtooth', f, f * 1.35, 0.25, 0.05 * a);
    this.tone('sawtooth', f * 1.35, f * 0.8, 0.45, 0.05 * a, 0.22);
  }
  flutter(pos?: THREE.Vector3) {
    const a = this.att(pos, 30);
    if (a < 0.05) return;
    for (let i = 0; i < 5; i++) this.noise(0.05, 0.08 * a, 1800, 'bandpass', i * 0.05);
  }
  ring() { this.tone('square', 1300, 1300, 0.08, 0.05); this.tone('square', 1300, 1300, 0.08, 0.05, 0.12); }
  cash() { this.tone('square', 1568, 1568, 0.06, 0.07); this.tone('square', 2093, 2093, 0.12, 0.07, 0.07); this.noise(0.08, 0.1, 5000, 'highpass', 0.02); }
  spray() { this.noise(0.9, 0.18, 3200, 'highpass'); }
  train(pos?: THREE.Vector3) { const a = this.att(pos, 90); if (a < 0.05) return; this.noise(2.5, 0.35 * a, 220); this.tone('sawtooth', 70, 50, 2.5, 0.12 * a); }
  missionStart() { [0, 7, 12].forEach((s, i) => this.tone('square', 330 * Math.pow(2, s / 12), 330 * Math.pow(2, s / 12), 0.16, 0.08, i * 0.11)); }
  checkpoint() { this.tone('square', 880, 880, 0.07, 0.08); this.tone('square', 1320, 1320, 0.12, 0.08, 0.07); }
  fail() { [7, 3, 0, -5].forEach((s, i) => this.tone('sawtooth', 196 * Math.pow(2, s / 12), 196 * Math.pow(2, s / 12), 0.28, 0.09, i * 0.17)); }
  loot() { [0, 4, 7, 12].forEach((s, i) => this.tone('square', 523 * Math.pow(2, s / 12), 523 * Math.pow(2, s / 12), 0.12, 0.08, i * 0.06)); }
  heatUp() { this.tone('sawtooth', 200, 260, 0.25, 0.08); this.tone('sawtooth', 260, 330, 0.25, 0.08, 0.15); }
  win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone('square', 392 * Math.pow(2, s / 12), 392 * Math.pow(2, s / 12), 0.25, 0.08, i * 0.09)); }
  busted() { [12, 8, 5, 0].forEach((s, i) => this.tone('sawtooth', 220 * Math.pow(2, s / 12), 220 * Math.pow(2, s / 12), 0.3, 0.1, i * 0.18)); this.noise(0.1, 0.3, 3000, 'highpass', 0.75); }
  horn(pos?: THREE.Vector3) {
    if (!this.ctx || this.ctx.currentTime < this.hornT) return;
    const a = this.att(pos, 60);
    if (a < 0.05) return;
    this.hornT = this.ctx.currentTime + 0.6;
    this.tone('sawtooth', 380, 370, 0.35, 0.07 * a);
    this.tone('sawtooth', 475, 465, 0.35, 0.06 * a);
  }
  alarmBell(sec: number) { if (this.ctx) this.alarmUntil = this.ctx.currentTime + sec; }
  carAlarm(v: Vehicle) { if (!this.carAlarms.includes(v)) this.carAlarms.push(v); }

  // ---- continuous
  update(dt: number, opts: { car: Vehicle | null; sirenDist: number; hack: boolean; time: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const tc = 0.06;
    const car = opts.car;
    if (car && !car.wrecked) {
      const sp = Math.abs(car.speed);
      const gear = Math.min(4, Math.floor(sp / 9));
      const rpm = (sp - gear * 9) / 9;
      const f = 45 + gear * 6 + rpm * 55 + Math.abs(car.throttle) * 10;
      this.engO1.frequency.setTargetAtTime(f, now, tc);
      this.engO2.frequency.setTargetAtTime(f * 0.5, now, tc);
      this.engF.frequency.setTargetAtTime(300 + rpm * 500 + Math.abs(car.throttle) * 500, now, tc);
      this.engG.gain.setTargetAtTime(0.09 + Math.abs(car.throttle) * 0.06, now, tc);
      this.tyreG.gain.setTargetAtTime(car.skidding ? Math.min(0.18, car.slip * 0.02 + 0.06) : 0, now, 0.05);
    } else {
      this.engG.gain.setTargetAtTime(0, now, 0.1);
      this.tyreG.gain.setTargetAtTime(0, now, 0.05);
    }
    const sv = opts.sirenDist < 140 ? Math.pow(1 - opts.sirenDist / 140, 1.5) * 0.06 : 0;
    this.sirenG.gain.setTargetAtTime(sv, now, 0.2);
    this.ambG.gain.setTargetAtTime(opts.hack ? 0.04 : 0.12, now, 0.2);
    // bank alarm: alternating two-tone
    if (now < this.alarmUntil) {
      const near = Math.max(0.15, this.att(new THREE.Vector3(-84, 0, -27), 160));
      this.alarmO.frequency.setTargetAtTime(Math.sin(now * 12) > 0 ? 950 : 720, now, 0.005);
      this.alarmG.gain.setTargetAtTime(0.05 * near, now, 0.05);
    } else this.alarmG.gain.setTargetAtTime(0, now, 0.2);
    // car alarms
    this.carAlarms = this.carAlarms.filter((v) => v.alarmT > 0);
    let ca = 0;
    for (const v of this.carAlarms) ca = Math.max(ca, this.att(v.pos, 90));
    if (ca > 0) {
      this.carAlarmO.frequency.setTargetAtTime(Math.sin(now * 9) > 0 ? 1100 : 650, now, 0.01);
      this.carAlarmG.gain.setTargetAtTime(0.05 * ca * (Math.sin(now * 18) > -0.3 ? 1 : 0), now, 0.01);
    } else this.carAlarmG.gain.setTargetAtTime(0, now, 0.1);
    void dt;
  }
}
