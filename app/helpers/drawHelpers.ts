import { Ellipse } from "./paragraphHelpers";
const BLUE_HEX = '#272757';
const DEEPBLUEGREEN_HEX = '#121c2dff';
const REDGREEN_HEX = '#ffffff20';

const romanNumerals = [
  'I.', 'II.', 'III.', 'IV.', 'V.', 'VI.', 'VII.', 'VIII.', 'IX.', 'X.',
  'XI.', 'XII.', 'XIII.', 'XIV.', 'XV.', 'XVI.', 'XVII.', 'XVIII.', 'XIX.', 'XX.'
];

const asciiStars = ['*', '✶', '✴', '🟅', '.'];

export type ColumnTextOpts = {
  x: number;
  y: number;
  width: number;
  height: number;
  columns?: number;
  columnGap?: number;
  lineHeight?: number;
  paragraphGap?: number;
  font?: string;
  color?: string;
  textAlign?: CanvasTextAlign;
  textBaseline?: CanvasTextBaseline;
};

export function punctToASCIIStar(punct: string): string {
  if (punct === ",") return "**";
  if (punct === ".") return "✶";
  if (punct === "!") return "✴";
  if (punct === "?") return "🟅";
  if (punct === ";") return "***";
  if (punct === ":") return "****";
  return punct;
}

export function drawRadialGraph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  index: number,
  opts?: { spokes?: number; baseAlpha?: number; lineWidth?: number }
) {
  const spokes = opts?.spokes ?? 16;
  const baseA  = opts?.baseAlpha ?? 0.75;
  const lw     = opts?.lineWidth ?? 1.5;

  // 1. make an offscreen buffer just big enough for the ellipse bounds
  const w = Math.ceil(rx * 2);
  const h = Math.ceil(ry * 2);
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return;

  // 3. draw spokes centered at (w/2, h/2) on the offscreen
  octx.save();
  octx.beginPath();
  octx.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2);
  octx.clip();

  octx.strokeStyle = 'white';
  octx.setLineDash?.([1, 1]);
  octx.lineWidth = lw;
  octx.globalAlpha = baseA;

  const r = Math.max(rx, ry);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const x2 = w / 2 + r * Math.cos(a);
    const y2 = h / 2 + r * Math.sin(a);
    octx.beginPath();
    octx.moveTo(w / 2, h / 2);
    octx.lineTo(x2, y2);
    octx.stroke();
  }

  // 4. apply elliptical radial alpha mask on the offscreen ONLY
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = 'destination-in';

  // build an elliptical gradient by scaling a circular one
  octx.save();
  octx.translate(w / 2, h / 2);
  octx.scale(1, ry / rx); // circle of radius rx → ellipse rx×ry
  const grad = octx.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.50)'); // 50% at center
  grad.addColorStop(1.0, 'rgba(255,255,255,0.00)'); // 0% at edge
  octx.fillStyle = grad;
  octx.beginPath();
  octx.arc(0, 0, rx, 0, Math.PI * 2);
  octx.fill();
  octx.restore();

  octx.restore();
  octx.globalCompositeOperation = 'source-over';

  ctx.drawImage(off, Math.round(cx - rx), Math.round(cy - ry));

  ctx.save();
  const fillRx = rx * 1.7;
  const fillRy = ry * 1.7;
  const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, fillRx);
  fillGrad.addColorStop(0.0, REDGREEN_HEX);
  fillGrad.addColorStop(0.9, 'rgba(39,39,87,0.0)');
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, fillRx, fillRy, 0, 0, Math.PI * 2);
  ctx.fill();
  

  ctx.restore();

  // 6. draw roman numerals inside rectangle outside ellipse in a random corner
  const f = 0.92;
  const corners = [
    { x: cx - rx ** f, y: cy - ry ** f, align: 'left' as const,  baseline: 'top' as const },
    { x: cx + rx ** f, y: cy - ry ** f, align: 'right' as const, baseline: 'top' as const },
    { x: cx - rx ** f, y: cy + ry ** f, align: 'left' as const,  baseline: 'bottom' as const },
    { x: cx + rx ** f, y: cy + ry ** f, align: 'right' as const, baseline: 'bottom' as const },
  ];
  const corner = corners[index % 4];
  const roman = romanNumerals[index % romanNumerals.length];

  ctx.save();
  ctx.font = `100px newsreader, serif`;
  ctx.fillStyle = '#ffffff30';
  ctx.textAlign = corner.align;
  ctx.textBaseline = corner.baseline;
  ctx.fillText(roman, corner.x, corner.y);
  ctx.restore();
}

export function drawBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  W: number,
  H: number,
  gridSize: number,
  lineWidth: number,
  lineColor: string,
  border: number,
) {
  ctx.save();

  const cx = originX + W / 2;
  const cy = originY + H / 2;
  const rInner = Math.min(W, H) * 0.35;
  const rOuter = Math.max(W, H) * 0.65;

  const grad = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
  grad.addColorStop(0.0, BLUE_HEX);
  grad.addColorStop(1.0, DEEPBLUEGREEN_HEX);

  ctx.fillStyle = grad;
  ctx.fillRect(originX, originY, W, H);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([1, 1]);

  const gx0 = originX + border;
  const gx1 = originX + W - border;
  const gy0 = originY + border;
  const gy1 = originY + H - border;

  for (let x = gx0; x <= gx1; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, gy1);
    ctx.stroke();
  }

  for (let y = gy0; y <= gy1; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(gx0, y);
    ctx.lineTo(gx1, y);
    ctx.stroke();
  }
  // ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  //draw outer border thicker
  ctx.strokeRect(gx0, gy0, W - (border * 2), H - (border * 2));

  ctx.restore();
}

export function drawWrappedColumns(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: ColumnTextOpts
): void {
  const {
    x, y, width, height,
    columns = 4,
    columnGap = 40,
    font,
    color = '#000',
    textAlign = 'start',
    textBaseline = 'top',
  } = opts;

  ctx.save();
  if (font) ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;

  // derive line/paragraph spacing from current font size if not provided
  const fontPx = Number((ctx.font.match(/(\d+(?:\.\d+)?)px/) || [])[1] || 16);
  const lineH   = opts.lineHeight   ?? fontPx * 1.2;
  const paraGap = opts.paragraphGap ?? fontPx * 0.6;

  // compute per-column width
  const colW = (width - (columns - 1) * columnGap) / columns;

  let col = 0;
  let cursorX = x;
  let cursorY = y;
  const bottom = y + height;

  const nextColumn = () => {
    col += 1;
    cursorX = x + col * (colW + columnGap);
    cursorY = y;
  };

  const paragraphs = text
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);

  for (const para of paragraphs) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > colW && line) {
        if (cursorY + lineH > bottom) nextColumn();
        ctx.fillText(line, cursorX, cursorY);
        cursorY += lineH;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      if (cursorY + lineH > bottom) nextColumn();
      ctx.fillText(line, cursorX, cursorY);
      cursorY += lineH;
    }
    // paragraph spacing
    cursorY += paraGap;
    if (cursorY > bottom) nextColumn();
    if (col >= columns) break; // stop if we’ve run out of columns
  }

  //draw footer in bottom of fourth
  //title in bold italic
  const footerY = y + height - lineH * 3.65;
  cursorX = x + (columns - 1) * (colW + columnGap);
  ctx.font = `bold italic ${fontPx}px newsreader, serif`;
  ctx.fillText("textellations", cursorX + 190, footerY);
  //made by in regular letters
  ctx.font = `${fontPx}px newsreader, serif`;
  ctx.fillText("crafted wth love - estelle kim", cursorX + 30, footerY + lineH);
  //current date in regular letters, place with end of string in 100 + curzorX
  const date = new Date();
  const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const dateWidth = ctx.measureText(dateStr).width;
  ctx.fillText(dateStr, cursorX + colW - dateWidth - 130, footerY + lineH * 2);
  //compass image next to text
  const compassImg = new Image();
  compassImg.src = '/compass.png';
  compassImg.onload = () => {
    const imgSize = 120;
    ctx.drawImage(compassImg, cursorX + colW - imgSize, footerY - 30, imgSize, imgSize);
  };
  ctx.restore();
}

export function drawSimpleFooter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) : void {
  ctx.save();
  const fontPx = 14;
  ctx.font = `${fontPx}px ibm-plex-mono, monospace`;
  ctx.fillStyle = '#ffffff80';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const footerText = "textellations - crafted wth love by estelle kim";
  ctx.fillText(footerText, x + width / 2, y + height / 2);

  ctx.restore();
}

export function drawHeader(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts?: {
    font?: string;
    color?: string;
    textAlign?: CanvasTextAlign;
    textBaseline?: CanvasTextBaseline;
  }
): void {
  const {
    font,
    color = '#000',
    textAlign = 'start',
    textBaseline = 'top',
  } = opts || {};

  ctx.save();
  if (font) ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;
  ctx.fillText(text, x, y);

  //draw line in remaining width with intermittend ascii stars
  const textWidth = ctx.measureText(text).width;
  const lineStartX = x + textWidth + 20;
  const remainingWidth = ctx.canvas.width - lineStartX - x;

  ctx.beginPath();
  ctx.lineTo(lineStartX, y + ctx.measureText(text).actualBoundingBoxDescent);
  ctx.lineTo(lineStartX + remainingWidth, y + ctx.measureText(text).actualBoundingBoxDescent);
  ctx.setLineDash([5, 10]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

export function drawAsciiParticles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  W: number,
  H: number,
  opts: {
    density?: number;          // particles per pixel
    sizePx?: number;           // font size
    noiseScale?: number;       // world→noise scale (smaller = larger features)
    noiseOctaves?: number;     // fBM octaves
    seed?: number;             // deterministic seed
    avoid?: Ellipse[];         // ellipses to bias away from
    avoidStrength?: number;    // how strongly to avoid
  } = {}
) {
  const {
    density = 0.00035,
    sizePx = 12,
    noiseScale = 0.0018,
    noiseOctaves = 3,
    seed = 13,
    avoid = [],
    avoidStrength = 1.4,
  } = opts;

  const p = new Uint8Array(512);
  (function makePerm(s: number) {
    // xorshift32
    const rnd = () => {
      s |= 0; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      return (s >>> 0) / 4294967296;
    };
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = base[i]; base[i] = base[j]; base[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  })(seed);

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number) => {
    // 8 grad dirs
    const u = (h & 1) === 0 ? x : -x;
    const v = (h & 2) === 0 ? y : -y;
    return u + v;
  };
  function perlin2(ax: number, ay: number) {
    const X = Math.floor(ax) & 255, Y = Math.floor(ay) & 255;
    const xf = ax - Math.floor(ax), yf = ay - Math.floor(ay);
    const u = fade(xf), v = fade(yf);
    const aa = p[X + p[Y]], ab = p[X + p[Y + 1]];
    const ba = p[X + 1 + p[Y]], bb = p[X + 1 + p[Y + 1]];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // roughly [-1,1]
  }
  function fbm(ax: number, ay: number, oct = 3) {
    let a = 0, amp = 0.5, freq = 1.0;
    for (let i = 0; i < oct; i++) {
      a += perlin2(ax * freq, ay * freq) * amp;
      freq *= 2.0;
      amp *= 0.5;
    }
    // map to [0,1]
    return a * 0.5 + 0.5;
  }

  // --- ellipse avoidance field (smooth distance falloff) ---
  function avoidWeight(px: number, py: number) {
    if (!avoid.length) return 1.0;
    let w = 1.0;
    for (const e of avoid) {
      const dx = (px - e.x) / (e.rx + 1e-6);
      const dy = (py - e.y) / (e.ry + 1e-6);
      const d2 = dx * dx + dy * dy; // <1 inside
      // smoothstep-ish: inside → suppress; near edge → attenuate
      const k = d2 < 1
        ? Math.max(0, 1 - Math.pow(1 - d2, 2) * avoidStrength) // strongly push out inside
        : 1 / (1 + Math.max(0, (1 / Math.sqrt(d2) - 1)) * 0.0); // ~1 outside
      w *= k;
    }
    return w;
  }

  const count = Math.floor(W * H * density);
  ctx.save();
  ctx.font = `${sizePx}px ibm-plex-mono, monospace`;
  ctx.fillStyle = "#ffffff70";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < count; i++) {
    const px = x + Math.random() * W;
    const py = y + Math.random() * H;

    const n = fbm(px * noiseScale, py * noiseScale, noiseOctaves); // [0,1]
    const wv = avoidWeight(px, py);

    const pass = n * wv > Math.random() * 0.85;
    if (!pass) continue;

    const idx = Math.min(asciiStars.length - 1, Math.floor(n * asciiStars.length));
    const ch = asciiStars[idx];

    ctx.fillText(ch, px, py);
  }

  ctx.restore();
}
