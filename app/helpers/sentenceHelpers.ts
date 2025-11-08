export type EllipsePlacement = { x: number; y: number; rx: number; ry: number };

export type CloudWord = {
  x: number; y: number;
  w: number; h: number;
  text: string;
  paragraphIndex: number;
  sentenceIndex: number;   // original sentence id (for loose grouping)
  wordIndex: number;       // index within sentence (appearance order)
  scale: number;           // paragraph text scale applied (0..1]
};

export type CloudConnector = {
  from: { x: number; y: number; p: number; s: number; w: number };
  to:   { x: number; y: number; p: number; s: number; w: number };
};

export type SentenceHull = { paragraphIndex: number; sentenceIndex: number; points: {x:number;y:number}[] };

export type LooseCloudOptions = {
  // text metrics
  font?: string;              // e.g. "24px ui-sans-serif"
  lineHeight?: number;        // base line height (pre-scale)
  wordGap?: number;           // base horizontal gap (pre-scale)

  // sizing / density
  innerPadding?: number;      // px: shrink parent ellipse radii by this much
  areaFill?: number;          // 0.25..0.55 — overall density in parent ellipse
  maxScale?: number;          // ≤ 1.0
  minScale?: number;          // ≥ 0.35

  // sentence clustering
  clusterFill?: number;       // 0.6..0.9 — fraction of parent area allocated to sum of mini-ellipses
  homeStrength?: number;      // 0.2..0.9 — attraction into sentence mini-ellipse
  anchorRepel?: number;       // 0.3..1.0 — repulsion between sentence centers
  anchorIters?: number;       // 10..40 — relaxation steps for sentence centers
  cohesion?: number;          // 0..0.15 — gentle pull toward sentence centroid
  link?: number;              // 0..0.6 — consecutive-words spring (visual order hint)

  // per-word relaxation
  iterations?: number;        // 20..80 — relaxation steps
  repel?: number;             // 0.6..1.2 — word-word repulsion
  boundary?: number;          // 0.3..0.7 — spring toward parent ellipse boundary
  jitter?: number;            // 0..1.5 — random seed jitter (px multiplier relative to font)
};

export type LooseCloudResult = {
  words: CloudWord[];
};


let _mCanvas: HTMLCanvasElement | null = null;
let _mCtx: CanvasRenderingContext2D | null = null;
let _mFont: string | null = null;

function mctx(font: string): CanvasRenderingContext2D {
  if (!_mCanvas) { _mCanvas = document.createElement('canvas'); _mCanvas.width = 64; _mCanvas.height = 64; }
  if (!_mCtx) { _mCtx = _mCanvas.getContext('2d')!; }
  if (_mFont !== font) { _mFont = font; _mCtx.font = font; }
  return _mCtx!;
}

function pxFromFont(font: string): number {
  const m = font.match(/(\d+(?:\.\d+)?)\s*px/i);
  return m ? parseFloat(m[1]) : 16;
}

// geometry helpers

function projectIntoEllipse(
  x: number, y: number,
  cx: number, cy: number,
  rx: number, ry: number,
  r: number // safety margin so a circle of radius r fits inside
) {
  const rxIn = Math.max(1, rx - r), ryIn = Math.max(1, ry - r);
  let u = (x - cx) / rxIn, v = (y - cy) / ryIn;
  const d2 = u*u + v*v;
  if (d2 <= 1) return { x, y };
  const s = 1 / Math.sqrt(d2);
  u *= s; v *= s;
  return { x: cx + u * rxIn, y: cy + v * ryIn };
}

function sunflowerInEllipse(
  n: number, cx: number, cy: number, rx: number, ry: number, jitter = 0
) {
  const pts: {x:number;y:number}[] = [];
  const phi = (1 + Math.sqrt(5)) / 2;
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / (n + 0.5));
    const a = 2 * Math.PI * k / (phi * phi);
    const ex = cx + rx * r * Math.cos(a);
    const ey = cy + ry * r * Math.sin(a);
    const jx = (Math.random()*2 - 1) * jitter;
    const jy = (Math.random()*2 - 1) * jitter;
    pts.push({ x: ex + jx, y: ey + jy });
  }
  return pts;
}

// Monotone chain convex hull
function convexHull(points: {x:number;y:number}[]): {x:number;y:number}[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a,b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const cross = (o:{x: number, y: number}, a:{x: number, y: number}, b:{x: number, y: number}) => (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  const lower:{x: number, y: number}[] = [];
  for (const p of pts) { while (lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p)<=0) lower.pop(); lower.push(p); }
  const upper:{x: number, y: number}[] = [];
  for (let i=pts.length-1;i>=0;i--){ const p=pts[i]; while(upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p)<=0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/**
 * Flow layout inside an ellipse.
 * Preserves word order. Rows curve with the ellipse boundary.
 * Returns normalized positions in the cluster (absolute coords).
 */
function flowLayoutInEllipse(
  words: { width:number; height:number }[],
  cx: number, cy: number, rx: number, ry: number,
  scale: number,
  gap: number,               // extra px between words (already scaled)
  rowStep?: number,          // vertical advance per row (scaled)
  jitterPx?: number          // small randomness
): {x:number;y:number}[] {
  const out: {x:number;y:number}[] = [];
  const stepY = rowStep ?? (words[0]?.height ?? 16) * 1.0 * scale; // ~line height
  const j = jitterPx ?? 0;

  // start near top and sweep down
  // use symmetrical rows around center for nicer balance
  const rows: number[] = [];
  for (let k = 0; ; k++) {
    const y = -k * stepY;
    if (Math.abs(y) > ry * 0.9) break;
    rows.push(y);
  }
  const sym: number[] = [];
  for (let i = rows.length - 1; i >= 1; i--) sym.push(rows[i]); // top half (neg)
  sym.push(0);                                                  // center
  for (let i = 1; i < rows.length; i++) sym.push(-rows[i]);     // bottom half (pos)
  // convert to absolute y
  for (let i = 0; i < sym.length; i++) sym[i] = cy + sym[i];

  let rowIdx = 0;
  let iWord = 0;

  while (iWord < words.length && rowIdx < sym.length) {
    const y = sym[rowIdx];

    // local ellipse width at this y: rx * sqrt(1 - ((y-cy)/ry)^2)
    const ny = (y - cy) / ry;
    const availHalf = rx * Math.sqrt(Math.max(0, 1 - ny * ny));
    const left = cx - availHalf * 0.95;   // small inner gutter
    const right = cx + availHalf * 0.95;

    // assemble a row until we run out of horizontal room
    let x = left;
    const rowStart = iWord;
    while (iWord < words.length) {
      const w = words[iWord].width * scale;
      const h = words[iWord].height * scale;
      const need = (iWord === rowStart ? w : w + gap);
      if (x + need > right) break;
      // place word center
      x += (iWord === rowStart ? 0 : gap) + w * 0.5;
      const rxj = (Math.random() * 2 - 1) * j;
      const ryj = (Math.random() * 2 - 1) * j * 0.35; // less vertical jitter
      out.push({ x: x + rxj, y: y + ryj });
      x += w * 0.5;
      iWord++;
    }

    // if we couldn’t place any word on this row, skip to next row
    if (iWord === rowStart) {
      rowIdx++;
      continue;
    }
    rowIdx++;
  }

  // If some words remain (very dense sentence), place the rest on last row crudely
  while (iWord < words.length) {
    const lastY = sym[Math.min(sym.length - 1, rowIdx - 1)];
    const ny = (lastY - cy) / ry;
    const availHalf = rx * Math.sqrt(Math.max(0, 1 - ny * ny));
    const left = cx - availHalf * 0.95;
    let x = left;
    const w = words[iWord].width * scale;
    x += w * 0.5;
    out.push({ x, y: lastY });
    iWord++;
  }

  return out;
}


// ------------------------------------------------------------
// Main: clustered ellipse-bounded layout

export function layoutLooseCloudClustered(
  structure: string[][],                 // paragraphs -> sentences (strings)
  placements: EllipsePlacement[],        // paragraph ellipses (centers already margin-adjusted)
  opt?: LooseCloudOptions & {
    clusterFill?: number;
    homeStrength?: number;
    anchorRepel?: number;
    anchorIters?: number;
  }
): LooseCloudResult {
  const font        = opt?.font ?? '24px ui-sans-serif';
  const basePx      = pxFromFont(font);
  const baseLH      = opt?.lineHeight ?? Math.round(basePx * 1.25);
  const baseGap     = opt?.wordGap ?? Math.round(basePx * 0.45);

  const innerPad    = opt?.innerPadding ?? Math.round(basePx * 0.8);

  const ITER        = opt?.iterations ?? 56;
  const K_REPEL     = opt?.repel ?? 0.95;
  const K_BOUND     = opt?.boundary ?? 0.45;
  const K_LINK      = opt?.link ?? 0.25;
  const K_COH       = opt?.cohesion ?? 0.05;
  const JITTER      = opt?.jitter ?? 0.9;

  const MAX_SCALE   = Math.min(1, opt?.maxScale ?? 1.0);
  const MIN_SCALE   = Math.max(0.35, opt?.minScale ?? 0.45);
  const PAR_FILL    = opt?.areaFill ?? 0.36;    // global density
  const CLU_FILL    = opt?.clusterFill ?? 0.8;  // sentence mini-ellipse budget

  const HOME_K      = opt?.homeStrength ?? 0.55;
  const A_REPEL     = opt?.anchorRepel ?? 0.7;
  const A_ITERS     = opt?.anchorIters ?? 18;

  const ctx = mctx(font);

  const outWords: CloudWord[] = [];

  for (let p = 0; p < structure.length; p++) {
    const plc = placements[p]; if (!plc) break;
    const cx = plc.x, cy = plc.y;
    const rx0 = Math.max(8, plc.rx - innerPad);
    const ry0 = Math.max(8, plc.ry - innerPad);

    //measure sentences + words
    const sentences = structure[p].map((s, sIdx) => {
      const tokens = s.split(/\s+/).filter(Boolean);
      const measures = tokens.map(t => Math.ceil(ctx.measureText(t).width));
      const words = tokens.map((t,i) => ({
        text: t,
        width: measures[i] + baseGap,
        height: baseLH
      }));
      const area = words.reduce((a, w) => a + w.width * w.height, 0); // weight proxy
      return { sIdx, words, weight: Math.max(1, area) };
    });

    if (!sentences.length) continue;

    // paragraph scale based on area
    const totalArea = sentences.reduce((a, s) => a + s.weight, 0);
    const targetArea = PAR_FILL * Math.PI * rx0 * ry0;
    const parScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.sqrt(targetArea / Math.max(1, totalArea))));

    // mini-ellipse for each sentence
    const clusterArea = CLU_FILL * Math.PI * rx0 * ry0;
    const scaleA = clusterArea / totalArea; // area per unit weight
    const parentAspect = rx0 / ry0;

    const clusters = sentences.map(s => {
      const Ai = Math.max(1, s.weight * scaleA);
      const ry_i = Math.sqrt(Ai / (Math.PI * parentAspect));
      const rx_i = parentAspect * ry_i;
      return { sIdx: s.sIdx, rx: rx_i, ry: ry_i, cx: 0, cy: 0 };
    });

    // place centers in sunflower pattern and relax
    const seeds = sunflowerInEllipse(clusters.length, cx, cy, rx0 * 0.9, ry0 * 0.9, JITTER * basePx);
    for (let i = 0; i < clusters.length; i++) { clusters[i].cx = seeds[i].x; clusters[i].cy = seeds[i].y; }

    for (let it = 0; it < A_ITERS; it++) {
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const a = clusters[i], b = clusters[j];
          const ra = 0.7 * (a.rx + a.ry) * 0.5;
          const rb = 0.7 * (b.rx + b.ry) * 0.5;
          const dx = b.cx - a.cx, dy = b.cy - a.cy;
          const d2 = dx*dx + dy*dy;
          const minD = ra + rb;
          if (d2 < minD*minD && d2 > 1e-4) {
            const d = Math.sqrt(d2);
            const push = (minD - d) * (A_REPEL / Math.max(1, d));
            const ux = dx / d, uy = dy / d;
            a.cx -= ux * push * 0.5; a.cy -= uy * push * 0.5;
            b.cx += ux * push * 0.5; b.cy += uy * push * 0.5;
            // keep anchors inside parent ellipse
            const pa = projectIntoEllipse(a.cx, a.cy, cx, cy, rx0, ry0, Math.max(ra, 8));
            const pb = projectIntoEllipse(b.cx, b.cy, cx, cy, rx0, ry0, Math.max(rb, 8));
            a.cx = pa.x; a.cy = pa.y; b.cx = pb.x; b.cy = pb.y;
          }
        }
      }
    }

    const clusterByS = new Map<number, {cx:number;cy:number;rx:number;ry:number}>();
    for (const c of clusters) clusterByS.set(c.sIdx, { cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry });

    type Node = { x:number; y:number; r:number; sIdx:number; wIdx:number; w:number; h:number };
    const nodes: Node[] = [];

    for (const s of sentences) {
    const cl = clusterByS.get(s.sIdx)!;

    const flowPts = flowLayoutInEllipse(
        s.words,
        cl.cx, cl.cy, cl.rx * 0.88, cl.ry * 0.88,
        parScale,
        baseGap * parScale,
        baseLH * 1.0 * parScale,
        JITTER * basePx * 0.35
    );

    // emit nodes (ensure each still fits both mini and parent ellipse)
    for (let i = 0; i < s.words.length; i++) {
        const ww = s.words[i].width * parScale;
        const hh = s.words[i].height * parScale;
        const rad = Math.sqrt(ww*ww + hh*hh) * 0.5 * 0.9;

        let pt = projectIntoEllipse(flowPts[i].x, flowPts[i].y, cl.cx, cl.cy, cl.rx, cl.ry, rad);
        pt = projectIntoEllipse(pt.x, pt.y, cx, cy, rx0, ry0, rad);

        nodes.push({ x: pt.x, y: pt.y, r: rad, sIdx: s.sIdx, wIdx: i, w: ww, h: hh });
    }
    }

    // links between consecutive words within each sentence (visual continuity)
    const links: Array<[number, number, number]> = [];
    {
      const byS = new Map<number, number[]>();
      for (let i = 0; i < nodes.length; i++) {
        const sIdx = nodes[i].sIdx;
        if (!byS.has(sIdx)) byS.set(sIdx, []);
        byS.get(sIdx)!.push(i);
      }
      for (const ids of byS.values()) {
        ids.sort((a,b) => nodes[a].wIdx - nodes[b].wIdx);
        for (let k = 0; k < ids.length - 1; k++) {
          const a = nodes[ids[k]], b = nodes[ids[k+1]];
          const target = ((a.w + b.w) * 0.25);
          links.push([ids[k], ids[k+1], target]);
        }
      }
    }

    // --- relaxation: repulsion + parent boundary + home-to-cluster + (optional) cohesion + links
    for (let it = 0; it < ITER; it++) {
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx*dx + dy*dy;
          const minD = a.r + b.r;
          if (d2 < minD*minD && d2 > 1e-4) {
            const d = Math.sqrt(d2);
            const push = (minD - d) * (K_REPEL / Math.max(1, d));
            const ux = dx / d, uy = dy / d;
            a.x -= ux * push * 0.5; a.y -= uy * push * 0.5;
            b.x += ux * push * 0.5; b.y += uy * push * 0.5;
          }
        }
      }
      // parent ellipse boundary
      for (const a of nodes) {
        const proj = projectIntoEllipse(a.x, a.y, cx, cy, rx0, ry0, a.r);
        a.x += (proj.x - a.x) * K_BOUND;
        a.y += (proj.y - a.y) * K_BOUND;
      }
      // home pull into sentence mini-ellipse
      for (const a of nodes) {
        const cl = clusterByS.get(a.sIdx)!;
        const home = projectIntoEllipse(a.x, a.y, cl.cx, cl.cy, cl.rx, cl.ry, a.r);
        a.x += (home.x - a.x) * HOME_K;
        a.y += (home.y - a.y) * HOME_K;
      }
      // optional cohesion toward sentence centroid
      if (K_COH > 0) {
        const cent = new Map<number, {x:number;y:number;c:number}>();
        for (const a of nodes) {
          const c = cent.get(a.sIdx) ?? { x:0,y:0,c:0 };
          c.x += a.x; c.y += a.y; c.c++;
          cent.set(a.sIdx, c);
        }
        for (const a of nodes) {
          const c = cent.get(a.sIdx)!;
          const mx = c.x / c.c, my = c.y / c.c;
          a.x += (mx - a.x) * K_COH;
          a.y += (my - a.y) * K_COH;
        }
      }
      // light links
      for (const [i, j, L0] of links) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(1e-3, Math.hypot(dx, dy));
        const diff = d - L0;
        const ux = dx / d, uy = dy / d;
        const k = K_LINK * 0.3;
        a.x += ux * diff * k * 0.5; a.y += uy * diff * k * 0.5;
        b.x -= ux * diff * k * 0.5; b.y -= uy * diff * k * 0.5;
      }
    }

    // --- emit words
    for (const n of nodes) {
      const s = sentences.find(ss => ss.sIdx === n.sIdx)!;
      const word = s.words[n.wIdx];
      outWords.push({
        x: n.x, y: n.y, w: n.w, h: n.h,
        text: word.text,
        paragraphIndex: p, sentenceIndex: n.sIdx, wordIndex: n.wIdx,
        scale: parScale
      });
    }
  }

  return { words: outWords };
}

export function drawCloudWords(
  ctx: CanvasRenderingContext2D,
  words: CloudWord[],
  color = 'white',
  fontFamily = 'ui-sans-serif'
) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let lastPx = -1;
  for (const w of words) {
    const px = Math.max(8, Math.round(pxFromFont(`16px ${fontFamily}`) * w.scale));
    if (px !== lastPx) { ctx.font = `${px}px ${fontFamily}`; lastPx = px; }
    ctx.fillStyle = color;
    ctx.fillText(w.text, w.x, w.y);
  }
  ctx.restore();
}

export function drawPosAccessories(
    ctx: CanvasRenderingContext2D,
    words: CloudWord[],
    structure: string[][],
    opts?: { fontSize?: number; circleRadius?: number; lineWidth?: number }
) {
    const fontSize = opts?.fontSize ?? 14;
    ctx.save();
    ctx.font = `${fontSize}px ui-sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.restore();
}