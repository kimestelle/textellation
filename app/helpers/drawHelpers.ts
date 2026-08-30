import { Ellipse } from "./paragraphHelpers";
import { seededRandom } from "./randomHelpers";
export const BLUE_HEX = '#272757';
export const DEEPBLUEGREEN_HEX = '#121c2dff';
export const REDGREEN_HEX = '#ffffff20';
let radialGraphScratchCanvas: HTMLCanvasElement | null = null;

function canvasMonoFamily() {
  if (typeof document === 'undefined') return '"Space Mono", monospace';
  const family = getComputedStyle(document.body)
    .getPropertyValue('--font-space-mono')
    .trim();
  return family || '"Space Mono", monospace';
}

const romanNumerals = [
  'I.', 'II.', 'III.', 'IV.', 'V.', 'VI.', 'VII.', 'VIII.', 'IX.', 'X.',
  'XI.', 'XII.', 'XIII.', 'XIV.', 'XV.', 'XVI.', 'XVII.', 'XVIII.', 'XIX.', 'XX.'
];

export const asciiStars = ['*', '✶', "\uE000", '✦', '.'];

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
  compassImage?: HTMLImageElement | null;
};

export function punctToASCIIStar(punct: string): string {
  if (punct === ",") return "**";
  if (punct === ".") return "✶";
  if (punct === "!") return "\uE000";
  if (punct === "?") return "🟅";
  if (punct === ";") return "***";
  if (punct === ":") return "****";
  return punct;
}

export function generateStarPattern(length: number, seed = 0x51a7): string {
  const L = Math.max(0, Math.min(length, 200));
  let pattern = '';
  const asciiStarsWithMore = asciiStars.concat(['-', '·', ' ', '_', '-', '·', ' ', '_']);
  const random = seededRandom(seed ^ L);
  for (let i = 0; i < L; i++) {
    const star = asciiStarsWithMore[Math.floor(random() * asciiStarsWithMore.length)];
    pattern += star;
  }
  return pattern;
}

export function drawRadialGraph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  index: number,
  opts?: {
    spokes?: number;
    baseAlpha?: number;
    lineWidth?: number;
    visibleBounds?: { x: number; y: number; width: number; height: number };
    showSpokes?: boolean;
    showEllipse?: boolean;
    showLabel?: boolean;
  }
) {
  const spokes = opts?.spokes ?? 16;
  const baseA  = opts?.baseAlpha ?? 0.75;
  const lw     = opts?.lineWidth ?? 1.5;
  const showSpokes = opts?.showSpokes ?? true;
  const showEllipse = opts?.showEllipse ?? true;
  const showLabel = opts?.showLabel ?? true;

  if (showSpokes) {
    // Bound each temporary spoke bitmap. Mobile Safari can retain recently
    // released canvases for several frames, so sequential full-size ellipses
    // can otherwise cross its process limit even though only one is live here.
    const logicalW = rx * 2;
    const logicalH = ry * 2;
    const transform = ctx.getTransform();
    const outputScale = Math.max(
      Math.hypot(transform.a, transform.b),
      Math.hypot(transform.c, transform.d),
    );
    const maxSpokePixels = 750_000;
    const budgetScale = Math.sqrt(maxSpokePixels / Math.max(1, logicalW * logicalH));
    const rasterScale = Math.max(0.25, Math.min(1, outputScale, budgetScale));
    const w = Math.max(1, Math.ceil(logicalW * rasterScale));
    const h = Math.max(1, Math.ceil(logicalH * rasterScale));
    const off = radialGraphScratchCanvas ?? document.createElement('canvas');
    radialGraphScratchCanvas = off;
    if (off.width < w) off.width = w;
    if (off.height < h) off.height = h;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    octx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);

    // 3. draw spokes centered at (w/2, h/2) on the offscreen
    octx.save();
    octx.beginPath();
    octx.ellipse(logicalW / 2, logicalH / 2, rx, ry, 0, 0, Math.PI * 2);
    octx.clip();

    octx.strokeStyle = 'white';
    octx.setLineDash?.([1, 1]);
    octx.lineWidth = lw;
    octx.globalAlpha = baseA;

    const r = Math.max(rx, ry);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const x2 = logicalW / 2 + r * Math.cos(a);
      const y2 = logicalH / 2 + r * Math.sin(a);
      octx.beginPath();
      octx.moveTo(logicalW / 2, logicalH / 2);
      octx.lineTo(x2, y2);
      octx.stroke();
    }

    // 4. apply elliptical radial alpha mask on the offscreen ONLY
    octx.globalAlpha = 1;
    octx.globalCompositeOperation = 'destination-in';

    // build an elliptical gradient by scaling a circular one
    octx.save();
    octx.translate(logicalW / 2, logicalH / 2);
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

    ctx.drawImage(
      off,
      0,
      0,
      w,
      h,
      Math.round(cx - rx),
      Math.round(cy - ry),
      logicalW,
      logicalH,
    );
  }

  if (showEllipse) {
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

  }

  // Put the region numeral on one of the ellipse's cardinal boundaries. In
  // the live field, clamp it just inside the visible world bounds so a region
  // remains identified even when that boundary falls beyond the viewport.
  if (!showLabel) return;
  const labelAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const labelAngle = labelAngles[index % labelAngles.length];
  let labelX = cx + rx * Math.cos(labelAngle);
  let labelY = cy + ry * Math.sin(labelAngle);
  const labelSize = 100;
  const labelInset = labelSize * 0.58;
  if (opts?.visibleBounds) {
    const bounds = opts.visibleBounds;
    labelX = Math.max(
      bounds.x + labelInset,
      Math.min(bounds.x + bounds.width - labelInset, labelX),
    );
    labelY = Math.max(
      bounds.y + labelInset,
      Math.min(bounds.y + bounds.height - labelInset, labelY),
    );
  }
  const roman = romanNumerals[index % romanNumerals.length];

  ctx.save();
  ctx.font = `500 ${labelSize}px Newsreader, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // A restrained deboss: the pale offset catches the lower edge while the
  // multiplied face sinks into the field. The later noise pass unifies both.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillText(roman, labelX + 1.5, labelY + 1.5);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(22,18,42,0.58)';
  ctx.fillText(roman, labelX, labelY);
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
    compassImage = null,
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
  const footerY = y + height - lineH * 3.65;
  cursorX = x + (columns - 1) * (colW + columnGap);
  const imgSize = 120;
  const compassX = cursorX + colW - imgSize;
  const compassY = footerY - 30;
  const compassRadius = imgSize / 2;
  const compassCenterX = compassX + compassRadius;
  const compassCenterY = compassY + compassRadius;
  const circleLeftAt = (textTop: number) => {
    const textCenterY = textTop + fontPx / 2;
    const dy = Math.max(
      -compassRadius,
      Math.min(compassRadius, textCenterY - compassCenterY),
    );
    return compassCenterX - Math.sqrt(compassRadius ** 2 - dy ** 2);
  };
  const thirdLineY = footerY + lineH * 2;
  const thirdLineRight = compassX - 10;
  const curveGap = circleLeftAt(thirdLineY) - thirdLineRight;
  const textRightAt = (textTop: number) => circleLeftAt(textTop) - curveGap;
  ctx.textAlign = 'right';

  // Preserve the third line's gap, then follow the compass curve upward.
  ctx.font = `bold italic ${fontPx}px newsreader, serif`;
  ctx.fillText('textellation.com', textRightAt(footerY), footerY);
  ctx.font = `${fontPx}px newsreader, serif`;
  ctx.fillText('crafted with love', textRightAt(footerY + lineH), footerY + lineH);
  const date = new Date();
  const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(dateStr, thirdLineRight, thirdLineY);

  if (compassImage) {
    ctx.drawImage(compassImage, compassX, compassY, imgSize, imgSize);
  }
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
  ctx.font = `${fontPx}px ${canvasMonoFamily()}`;
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
    logicalCanvasWidth?: number;
  }
): void {
  const {
    font,
    color = '#000',
    textAlign = 'start',
    textBaseline = 'top',
    logicalCanvasWidth = ctx.canvas.width,
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
  const remainingWidth = logicalCanvasWidth - lineStartX - x;

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
    noiseScale?: number;       // world to noise scale (smaller = larger features)
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
  const rnd = seededRandom(seed);
  (function makePerm() {
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = base[i]; base[i] = base[j]; base[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  })();

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
    return lerp(x1, x2, v); // [-1,1]
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

  // weight to avoid ellipses
  function avoidWeight(px: number, py: number) {
    if (!avoid.length) return 1.0;
    let w = 1.0;
    for (const e of avoid) {
      const dx = (px - e.x) / (e.rx + 1e-6);
      const dy = (py - e.y) / (e.ry + 1e-6);
      const d2 = dx * dx + dy * dy; // <1 inside
      // smoothstep-like
      const k = d2 < 1
        ? Math.max(0, 1 - Math.pow(1 - d2, 2) * avoidStrength) // strongly push out inside
        : 1 / (1 + Math.max(0, (1 / Math.sqrt(d2) - 1)) * 0.0); // ~1 outside
      w *= k;
    }
    return w;
  }

  const count = Math.floor(W * H * density);
  ctx.save();
  ctx.font = `${sizePx}px "Star Glyphs", ${canvasMonoFamily()}`;
  ctx.fillStyle = "#ffffff70";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < count; i++) {
    const px = x + rnd() * W;
    const py = y + rnd() * H;

    const n = fbm(px * noiseScale, py * noiseScale, noiseOctaves); // [0,1]
    const wv = avoidWeight(px, py);

    const pass = n * wv > rnd() * 0.85;
    if (!pass) continue;

    const idx = Math.min(asciiStars.length - 1, Math.floor(n * asciiStars.length));
    const ch = asciiStars[idx];

    ctx.fillText(ch, px, py);
  }

  ctx.restore();
}
