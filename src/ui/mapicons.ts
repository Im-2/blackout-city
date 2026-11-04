// Map icons: every kind of place has its own silhouette as well as its colour, so
// they read at a glance. Shared by the full map, the location list and the minimap.

export type IconKind = 'diamond' | 'flag' | 'house' | 'bank' | 'shield' | 'tower' | 'circle' | 'coin' | 'garage' | 'ramp' | 'taxi' | 'metro' | 'wheel' | 'wheelpay' | 'police' | 'cluster';

const INK = '#0a1218', EDGE = '#0f141c';

/** half-size in pixels at scale 1: bigger means more important */
export const ICON_R: Record<IconKind, number> = {
  diamond: 14, flag: 13, house: 13, bank: 12, shield: 12, tower: 11, ramp: 11, circle: 9, coin: 9, garage: 8, taxi: 6, metro: 6, wheel: 6, wheelpay: 6, police: 5, cluster: 10,
};

function poly(c: CanvasRenderingContext2D, pts: number[][], x: number, y: number, r: number, offset = 0) {
  c.beginPath();
  pts.forEach(([px, py], i) => {
    const X = x + px * (r + offset), Y = y + py * (r + offset);
    if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
  });
  c.closePath();
  c.fill();
}

const SHAPE: Partial<Record<IconKind, number[][]>> = {
  diamond: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  house: [[0, -1], [1, -0.05], [0.72, -0.05], [0.72, 0.85], [-0.72, 0.85], [-0.72, -0.05], [-1, -0.05]],
  shield: [[-0.85, -0.85], [0.85, -0.85], [0.85, 0.15], [0, 1], [-0.85, 0.15]],
  ramp: [[-1, 0.75], [1, -0.75], [1, 0.75]],
  metro: [[-1, -0.8], [1, -0.8], [0, 1]],
  tower: [[-0.45, -1], [0.45, -1], [0.45, 1], [-0.45, 1]],
};

/** draws centred on (x, y). `s` scales it; `glow` adds a selection ring. */
export function drawIcon(c: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, s: number, color: string, tag?: string, glow = false) {
  const r = ICON_R[kind] * s;
  if (glow) {
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath();
    c.arc(x, y, r + 7, 0, Math.PI * 2);
    c.fill();
  }
  const shape = SHAPE[kind];
  if (shape) {
    c.fillStyle = EDGE;
    poly(c, shape, x, y, r, 2);
    c.fillStyle = color;
    poly(c, shape, x, y, r);
  } else if (kind === 'circle' || kind === 'coin' || kind === 'wheel' || kind === 'wheelpay' || kind === 'cluster') {
    c.fillStyle = EDGE;
    c.beginPath();
    c.arc(x, y, r + 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    if (kind === 'wheel' || kind === 'wheelpay') {
      c.fillStyle = EDGE;
      c.beginPath();
      c.arc(x, y, r * 0.5, 0, Math.PI * 2);
      c.fill();
      if (kind === 'wheelpay') { c.fillStyle = '#ffd24a'; c.fillRect(x - r * 0.28, y - r * 0.28, r * 0.56, r * 0.56); }
    }
    if (kind === 'coin') { c.fillStyle = EDGE; c.beginPath(); c.arc(x, y, r * 0.72, 0, Math.PI * 2); c.fill(); c.fillStyle = color; c.beginPath(); c.arc(x, y, r * 0.58, 0, Math.PI * 2); c.fill(); }
  } else if (kind === 'flag') {
    c.fillStyle = EDGE;
    c.fillRect(x - r * 0.8 - 2, y - r - 2, r * 1.8 + 4, r * 1.2 + 4);
    c.fillRect(x - r * 0.8 - 2, y - r, r * 0.3 + 4, r * 2 + 2);
    c.fillStyle = color;
    c.fillRect(x - r * 0.8, y - r, r * 0.3, r * 2);
    c.fillRect(x - r * 0.5, y - r, r * 1.5, r * 1.2);
    c.fillStyle = INK;
    const q = r * 0.4;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) c.fillRect(x - r * 0.5 + i * (r * 1.5 / 4), y - r + j * q, r * 1.5 / 4, q);
  } else if (kind === 'bank') {
    c.fillStyle = EDGE;
    poly(c, [[0, -1], [1, -0.3], [1, 0.95], [-1, 0.95], [-1, -0.3]], x, y, r, 2);
    c.fillStyle = color;
    poly(c, [[0, -1], [1, -0.35], [-1, -0.35]], x, y, r);
    c.fillRect(x - r, y + r * 0.62, r * 2, r * 0.33);
    for (const k of [-0.75, -0.13, 0.49]) c.fillRect(x + k * r, y - r * 0.25, r * 0.26, r * 0.9);
  } else if (kind === 'garage') {
    c.fillStyle = EDGE;
    c.fillRect(x - r - 2, y - r - 2, r * 2 + 4, r * 2 + 4);
    c.fillStyle = color;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  } else if (kind === 'taxi') {
    c.fillStyle = EDGE;
    c.fillRect(x - r * 1.3 - 1.5, y - r * 0.8 - 1.5, r * 2.6 + 3, r * 1.6 + 3);
    c.fillStyle = color;
    c.fillRect(x - r * 1.3, y - r * 0.8, r * 2.6, r * 1.6);
    c.fillStyle = INK;
    for (let i = 0; i < 3; i++) c.fillRect(x - r * 1.1 + i * r * 0.8, y - r * 0.15, r * 0.4, r * 0.3);
  } else if (kind === 'police') {
    c.fillStyle = EDGE;
    c.fillRect(x - r - 1, y - r * 0.6 - 1, r * 2 + 2, r * 1.2 + 2);
    c.fillStyle = color;
    c.fillRect(x - r, y - r * 0.6, r, r * 1.2);
    c.fillStyle = color === '#e0322a' ? '#2b5ce0' : '#e0322a';
    c.fillRect(x, y - r * 0.6, r, r * 1.2);
  }
  if (tag && (kind === 'diamond' || kind === 'circle' || kind === 'garage' || kind === 'coin' || kind === 'cluster')) {
    c.fillStyle = INK;
    c.font = `${Math.round(Math.max(11, r * 1.25))}px VT323, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(tag, x, y + 1);
  }
}

const urls = new Map<string, string>();

/** a data URL of an icon for DOM rows and the legend */
export function iconUrl(kind: IconKind, color: string, tag?: string) {
  const key = `${kind}|${color}|${tag ?? ''}`;
  let u = urls.get(key);
  if (!u) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 36;
    const c = cv.getContext('2d')!;
    drawIcon(c, kind, 18, 18, 1, color, tag);
    u = cv.toDataURL();
    urls.set(key, u);
  }
  return u;
}
