import { Ellipse } from "./paragraphHelpers";
import { seededRandom } from "./randomHelpers";
import type { BurnMode } from "../settings/burnMode";
export const BLUE_HEX = '#272757';
export const DEEPBLUEGREEN_HEX = '#121c2dff';
const ELLIPSE_GLOW_RGB = '162,168,209';

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

export const asciiStars = [
  '✦',
  '✶',
  '·',
  '.',
];

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
  if (punct === "!") return "✦";
  if (punct === "?") return "✦✶";
  if (punct === ";") return "***";
  if (punct === ":") return "****";
  return punct;
}

export function drawBlendedWhiteText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillText(text, x, y);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(text, x, y);
  ctx.restore();
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
    lineScale?: number;
    labelScale?: number;
    wordCount?: number;
    visibleBounds?: { x: number; y: number; width: number; height: number };
    showSpokes?: boolean;
    showEllipse?: boolean;
    showLabel?: boolean;
    burnMode?: BurnMode;
  }
) {
  const spokes = opts?.spokes ?? 16;
  const baseA  = opts?.baseAlpha ?? 0.9;
  const lineScale = opts?.lineScale ?? 1;
  const lw     = (opts?.lineWidth ?? 1.8) * lineScale;
  const showSpokes = opts?.showSpokes ?? true;
  const showEllipse = opts?.showEllipse ?? true;
  const showLabel = opts?.showLabel ?? true;
  const burnMode = opts?.burnMode ?? 'dark';

  if (showEllipse) {
    ctx.save();
    const wordCount = Math.max(1, opts?.wordCount ?? 24);
    const baseGlowScale = Math.max(1.3, 1.15 + Math.sqrt(wordCount) * 0.11);
    const glowScale = Math.min(2.75, Math.max(1.65, baseGlowScale * 1.28));
    const fillRx = rx * glowScale;
    const fillRy = ry * glowScale;
    const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, fillRx);
    // A three-sigma-style falloff: one hue throughout avoids the pale center
    // and blue fringe produced by interpolating between unrelated colors.
    fillGrad.addColorStop(0.0, `rgba(${ELLIPSE_GLOW_RGB},0.135)`);
    fillGrad.addColorStop(0.22, `rgba(${ELLIPSE_GLOW_RGB},0.109)`);
    fillGrad.addColorStop(0.45, `rgba(${ELLIPSE_GLOW_RGB},0.054)`);
    fillGrad.addColorStop(0.68, `rgba(${ELLIPSE_GLOW_RGB},0.017)`);
    fillGrad.addColorStop(0.86, `rgba(${ELLIPSE_GLOW_RGB},0.004)`);
    fillGrad.addColorStop(1.0, `rgba(${ELLIPSE_GLOW_RGB},0)`);
    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, fillRx, fillRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (showSpokes) {
    const spokeRadius = Math.max(rx, ry);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = baseA;
    ctx.lineWidth = lw;
    ctx.setLineDash([3, 3]);
    const strokeSpokes = (offset: number) => {
      for (let i = 0; i < spokes; i++) {
        const angle = (i / spokes) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + offset, cy + offset);
        ctx.lineTo(
          cx + spokeRadius * Math.cos(angle) + offset,
          cy + spokeRadius * Math.sin(angle) + offset,
        );
        ctx.stroke();
      }
    };

    if (burnMode === 'light') {
      ctx.globalCompositeOperation = 'soft-light';
      const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, spokeRadius);
      light.addColorStop(0, 'rgba(255,255,255,0.72)');
      light.addColorStop(1, 'rgba(255,255,255,0.44)');
      ctx.strokeStyle = light;
      strokeSpokes(0);

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      strokeSpokes(1.25);
    } else {
      // A restrained pale offset catches one edge; the multiplied face sinks
      // into the field like the ellipse links and numerals.
      ctx.strokeStyle = 'rgba(255,255,255,0.11)';
      strokeSpokes(1.1);

      ctx.globalCompositeOperation = 'multiply';
      const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, spokeRadius);
      dark.addColorStop(0, 'rgba(15,11,32,0.92)');
      dark.addColorStop(1, 'rgba(15,11,32,0.68)');
      ctx.strokeStyle = dark;
      strokeSpokes(0);
    }
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
  const labelSize = 100 * (opts?.labelScale ?? 1);
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

  if (burnMode === 'light') {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(roman, labelX, labelY);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillText(roman, labelX + 1.25, labelY + 1.25);
  } else {
    // A restrained deboss: the pale offset catches the lower edge while the
    // multiplied face sinks into the field.
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillText(roman, labelX + 1.5, labelY + 1.5);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(22,18,42,0.58)';
    ctx.fillText(roman, labelX, labelY);
  }
  ctx.restore();
}

export function drawBurnedEllipseConnector(
  ctx: CanvasRenderingContext2D,
  first: { x: number; y: number },
  second: { x: number; y: number },
  lineScale = 1,
  burnMode: BurnMode = 'dark',
) {
  ctx.save();
  ctx.lineWidth = 1.8 * lineScale;
  ctx.setLineDash([3, 3]);

  const strokeConnector = (offset: number) => {
    ctx.beginPath();
    ctx.moveTo(first.x + offset, first.y + offset);
    ctx.lineTo(second.x + offset, second.y + offset);
    ctx.stroke();
  };

  if (burnMode === 'light') {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    strokeConnector(0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    strokeConnector(1.25);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.11)';
    strokeConnector(1.1);
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = 'rgba(15,11,32,0.86)';
    strokeConnector(0);
  }
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
    probabilityBand?: { low: number; high: number }; // remap noise into density
    probabilityScale?: number; // cap the densest parts of the field
    seed?: number;             // deterministic seed
    avoid?: Ellipse[];         // ellipses to bias away from
    avoidStrength?: number;    // how strongly to avoid
    avoidPadding?: number;     // quiet halo beyond each ellipse
  } = {}
) {
  const {
    density = 0.00035,
    sizePx = 12,
    noiseScale = 0.0018,
    noiseOctaves = 3,
    probabilityBand,
    probabilityScale = 1,
    seed = 13,
    avoid = [],
    avoidStrength = 1.4,
    avoidPadding = 0.2,
  } = opts;

  const p = new Uint8Array(512);
  const rnd = seededRandom(seed);
  // Density and mark choice are separate signals. Perlin noise decides where
  // particles gather; a second stable stream preserves the full five-mark set
  // instead of collapsing nearly every accepted particle to the middle glyph.
  const glyphRnd = seededRandom(seed ^ 0x9e3779b9);
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
      const halo = 1 + avoidPadding;
      const dx = (px - e.x) / (e.rx * halo + 1e-6);
      const dy = (py - e.y) / (e.ry * halo + 1e-6);
      const distance = Math.hypot(dx, dy);

      // The old field read as atmosphere between regions: a clear core, then
      // a soft return just beyond the ellipse rather than stars crossing the
      // words and radial construction. Keep that relationship deterministic.
      const featherStart = 0.72;
      const t = Math.max(
        0,
        Math.min(1, (distance - featherStart) / (1 - featherStart)),
      );
      const smooth = t * t * (3 - 2 * t);
      const k = Math.pow(smooth, avoidStrength / 1.4);
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

    const probability = probabilityBand
      ? (() => {
          const span = Math.max(1e-6, probabilityBand.high - probabilityBand.low);
          const t = Math.max(0, Math.min(1, (n - probabilityBand.low) / span));
          return t * t * (3 - 2 * t);
        })()
      : Math.min(1, n / 0.85);
    const pass = Math.min(1, probability * probabilityScale) * wv > rnd();
    if (!pass) continue;

    const idx = Math.min(
      asciiStars.length - 1,
      Math.floor(glyphRnd() * asciiStars.length),
    );
    const ch = asciiStars[idx];

    ctx.fillText(ch, px, py);
  }

  ctx.restore();
}
