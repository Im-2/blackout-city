// What are we running on? Read once at start-up. `?touch` and `?mobile` force the
// phone behaviour on a desktop for testing, `?desktop` forces it off.
const q = new URLSearchParams(location.search);
const ua = navigator.userAgent;
const coarse = matchMedia?.('(pointer: coarse)').matches ?? false;
const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const phoneUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);

export const device = {
  /** show touch controls: a real touch-first device, not a laptop with a touch screen */
  touch: !q.has('desktop') && (q.has('touch') || (touchCapable && coarse)),
  /** use the mobile quality presets and smaller pools */
  mobile: !q.has('desktop') && (q.has('mobile') || q.has('touch') || (touchCapable && coarse && phoneUa)),
  iPhone: /iPhone|iPod/.test(ua),
  standalone: matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true,
  /** few gigabytes or few cores: start even lower and stay there */
  lowEnd: ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4,
};

/** on-screen text talks about buttons rather than keys on a touch device */
export function touchText(s: string) {
  if (!device.touch) return s;
  return s
    .replace(/\[E\]\s*/g, '')
    .replace(/Hold Q: right-click a light ahead for ALL RED/g, 'Hold HACK: ALT on a light ahead for ALL RED')
    .replace(/Hold Q/g, 'Hold HACK')
    .replace(/F \+ W or S/g, 'TRICK + GAS or BRAKE')
    .replace(/F \+ S/g, 'TRICK + BRAKE')
    .replace(/[Hh]old F/g, 'hold TRICK')
    .replace(/A\/D/g, 'the stick')
    .replace(/[Pp]ress E on/g, 'tap the action button at')
    .replace(/[Hh]old E/g, 'hold the action button')
    .replace(/\bE at the\b/g, 'The action button at the')
    .replace(/[Pp]ress M for the map\.?/g, 'MAP is at the top.')
    .replace(/, M for the map/g, ', MAP is at the top')
    .replace(/E at the front door/g, 'the action button at the front door');
}
