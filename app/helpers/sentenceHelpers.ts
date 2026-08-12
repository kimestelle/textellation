// sentenceHelpers.ts
import { forceSimulation, forceManyBody, forceLink, forceCollide, SimulationLinkDatum, Simulation } from 'd3-force';
import type { POSBucket } from './posHelpers';

export type EllipsePlacement = { x: number; y: number; rx: number; ry: number };

export type WordNode = {
  x?: number; y?: number; vx?: number; vy?: number;
  wPx: number;
  text: string;
  raw: string;
  punctOnly: boolean;
  p: number; s: number; w: number;
  r: number;
  scale: number;
  isFirstInSentence: boolean;
  bucket: POSBucket;
};

export type WordLinkKind = 'order' | 'samePOS' | 'samePOSWeak' | 'punct';

export type WordLink = SimulationLinkDatum<WordNode> & {
  source: number | WordNode;
  target: number | WordNode;
  strength?: number;
  kind: WordLinkKind;
};

export type SentenceCenter = { x: number; y: number; r: number; p: number; s: number };

function fontString(opts: { italic?: boolean; weight?: number; size?: number; family?: string }) {
  const style = opts.italic ? 'italic' : 'normal';
  const weight = (opts.weight ?? 400).toString();
  const size = `${opts.size ?? 24}px`;
  const fam = opts.family ?? 'Newsreader';
  return `${style} ${weight} ${size} ${fam}`;
}

export function makeFonts(opts: { family?: string; wordPx?: number }) {
  const fam = opts.family ?? 'Newsreader';
  const wordPx = opts.wordPx ?? 24;

  const normalFont = () => fontString({ weight: 300, family: fam, size: wordPx });
  const firstWordFont = () => fontString({ italic: true, weight: 700, size: wordPx + 4, family: fam });
  const nounFont = () => fontString({ weight: 600, family: fam, size: wordPx });
  const verbFont = () => fontString({ family: fam, size: wordPx });
  const adjectiveFont = () => fontString({ italic: true, family: fam, size: wordPx });
  const headerFont = (size: number) => fontString({ weight: 500, italic: true, size: size ?? 44, family: fam });

  return { normalFont, firstWordFont, nounFont, verbFont, adjectiveFont, headerFont };
}

export function clampEllipse(
  x: number, y: number,
  cx: number, cy: number,
  rx: number, ry: number,
  r: number
) {
  const rxIn = Math.max(1, rx - r);
  const ryIn = Math.max(1, ry - r);
  const u = (x - cx) / rxIn;
  const v = (y - cy) / ryIn;
  const d2 = u * u + v * v;
  if (d2 <= 1) return { x, y };
  const s = 1 / Math.sqrt(d2 || 1);
  return { x: cx + u * s * rxIn, y: cy + v * s * ryIn };
}

function pxFromFontPx(px: number) {
  return px;
}

export function computeSentenceCentersFromTokens(
  ctx: CanvasRenderingContext2D,
  sentenceTokens: string[][],
  par: EllipsePlacement,
  fontPx: number
): SentenceCenter[] {
  const baseGap = Math.round(pxFromFontPx(fontPx) * 0.45);
  const lineH = Math.round(pxFromFontPx(fontPx) * 1.2);

  const areas = sentenceTokens.map(tokens =>
    Math.max(1, tokens.reduce((acc, t) => {
      const w = Math.ceil(ctx.measureText(t).width) + baseGap;
      return acc + w * lineH;
    }, 0))
  );

  const totalArea = areas.reduce((a, b) => a + b, 0);
  const targetFill = 0.36;
  const targetArea = targetFill * Math.PI * par.rx * par.ry;
  const scale = Math.sqrt(targetArea / Math.max(1, totalArea));

  const radii = areas.map(a => Math.sqrt((a * scale * scale) / Math.PI) * 0.8 + 12);

  // sunflower seeds
  const out: { x: number; y: number }[] = [];
  const phi = (1 + Math.sqrt(5)) / 2;
  for (let k = 0; k < sentenceTokens.length; k++) {
    const r = Math.sqrt((k + 0.5) / (sentenceTokens.length + 0.5));
    const a = 2 * Math.PI * k / (phi * phi);
    out.push({ x: par.x + par.rx * 0.9 * r * Math.cos(a), y: par.y + par.ry * 0.9 * r * Math.sin(a) });
  }

  const centers: SentenceCenter[] = radii.map((r, i) => ({ x: out[i].x, y: out[i].y, r, p: 0, s: i }));

  // separate & clamp (same as you had)
  for (let it = 0; it < 16; it++) {
    for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) {
      const a = centers[i], b = centers[j];
      const dx = b.x - a.x, dy = b.y - a.y, minD = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2), ux = dx / d, uy = dy / d, push = (minD - d) * 0.5;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        let t = clampEllipse(a.x, a.y, par.x, par.y, par.rx, par.ry, a.r); a.x = t.x; a.y = t.y;
        t = clampEllipse(b.x, b.y, par.x, par.y, par.rx, par.ry, b.r); b.x = t.x; b.y = t.y;
      }
    }
  }

  return centers;
}

export function sentenceCenterForce(centers: SentenceCenter[], strength = 0.1) {
  const byPS = new Map<string, SentenceCenter>();
  for (const c of centers) byPS.set(`${c.p}:${c.s}`, c);

  function force(alpha: number) {
    const self = force as unknown as { nodes?: WordNode[] };
    const nodes = self.nodes ?? [];
    const k = strength * alpha;

    for (const n of nodes) {
      const c = byPS.get(`${n.p}:${n.s}`);
      if (!c) continue;

      const nx = n.x ?? c.x; const ny = n.y ?? c.y;
      const dx = c.x - nx; const dy = c.y - ny;
      const dist = Math.hypot(dx, dy) || 1;
      const inside = dist < c.r;
      const f = inside ? k * 0.6 : k * 1.25;

      n.vx = (n.vx ?? 0) + (dx / dist) * f; n.vy = (n.vy ?? 0) + (dy / dist) * f;
    }
  }

  force.initialize = (nodes: WordNode[]) => {
    (force as unknown as { nodes?: WordNode[] }).nodes = nodes;
  };

  return force as unknown as (alpha: number) => void;
}

export function buildParagraphSim(args: {
  ctx: CanvasRenderingContext2D;
  sentences: string[];
  paragraphIndex: number;
  parEllipse: EllipsePlacement;
  wordPx: number;
  tokenizeAndBucket: (s: string) => { tokens: string[]; buckets: POSBucket[] };
  random?: () => number;
}): { nodes: WordNode[]; links: WordLink[]; sim: Simulation<WordNode, undefined> } {
  const {
    ctx,
    sentences,
    paragraphIndex: p,
    parEllipse,
    wordPx,
    tokenizeAndBucket,
    random = Math.random,
  } = args;

  const BASE_WORD = 24;
  const kWord = Math.max(0.5, Math.min(2.0, wordPx / BASE_WORD));
  const PAD = Math.max(2, Math.round(0.22 * wordPx));
  const JITTER = Math.max(1, Math.round(4 * kWord));

  const SENT_STRENGTH = 0.20 * (1 / (kWord ** 0.3));
  const CHARGE_STRENGTH = -18 * (1 / (kWord ** 0.3));
  const CLAMP_PUSH = 0.4 * (1 / kWord);

  ctx.font = `${wordPx}px Newsreader`;
  const baseGap = Math.round(pxFromFontPx(wordPx) * 0.45) + Math.round(PAD * 0.6);
  const lineH = Math.round(pxFromFontPx(wordPx) * 1.2);

  // tag+tokenize once
  const tagged = sentences.map(tokenizeAndBucket);
  const sentenceTokens = tagged.map(t => t.tokens);

  const sentCenters = computeSentenceCentersFromTokens(ctx, sentenceTokens, parEllipse, wordPx)
    .map((c, sIdx) => ({ ...c, p, s: sIdx }));

  const nodes: WordNode[] = [];
  const links: WordLink[] = [];

  for (let s = 0; s < tagged.length; s++) {
    const { tokens, buckets } = tagged[s];
    const c = sentCenters[s];

    const firstWordIdx = buckets.findIndex(b => b !== 'PUNC');
    const idxOfNounsAndVerbs: number[] = [];
    let prevIdx: number | null = null;

    for (let w = 0; w < tokens.length; w++) {
      const raw = tokens[w];
      const bucket = buckets[w] ?? 'OTHER';
      const punctOnly = bucket === 'PUNC';

      const isFirstInSentence = (w === firstWordIdx);
      const measurementFont = isFirstInSentence
        ? fontString({ italic: true, weight: 700, size: wordPx + 4, family: 'Newsreader' })
        : bucket === 'ADJ'
          ? fontString({ italic: true, size: wordPx, family: 'Newsreader' })
          : bucket === 'NOUN'
            ? fontString({ weight: 600, size: wordPx, family: 'Newsreader' })
            : fontString({ size: wordPx, family: 'Newsreader' });
      ctx.font = measurementFont;
      const wPx = Math.ceil(ctx.measureText(raw).width);
      const width = wPx + baseGap;
      const height = isFirstInSentence ? lineH + 4 : lineH;
      // Collision follows the drawn label's axis-aligned footprint. A
      // diagonal radius overestimates every word and makes dense fixed
      // compositions needlessly expensive to settle.
      const r = Math.max(width * 0.5, height * 0.5) + PAD;

      const x = c.x - c.r + (c.r * 2) * ((w + 1) / (tokens.length + 1)) + (random() * 2 - 1) * JITTER;
      const y = c.y + (random() * 2 - 1) * JITTER;

      const nodeIndex = nodes.length;

      nodes.push({
        x, y, vx: 0, vy: 0,
        text: raw,
        raw,
        punctOnly,
        p, s, w,
        r,
        scale: 1.0,
        bucket,
        isFirstInSentence,
        wPx,
      });

      if (w == 0 || bucket === 'NOUN' || bucket === 'VERB' || bucket === 'PRON') idxOfNounsAndVerbs.push(nodeIndex);

      if (prevIdx !== null) {
        const prev = nodes[prevIdx];
        const kind: WordLinkKind = (prev.punctOnly || punctOnly) ? 'punct' : 'order';

        if (kind === 'punct') {
          //punctuation link
          links.push({ source: prevIdx, target: nodeIndex, strength: 0.05, kind });
        } else {
          //normal order
          links.push({ source: prevIdx, target: nodeIndex, strength: 0.005, kind: 'order' });
        }

        if (!prev.punctOnly && !punctOnly) {
          if ((prev.bucket === 'NOUN' && bucket === 'NOUN') || (prev.bucket === 'VERB' && bucket === 'VERB')) {
            links.push({ source: prevIdx, target: nodeIndex, strength: 0.10, kind: 'samePOS' });
          }
        }
      }

      prevIdx = nodeIndex;
    }

    for (let i = 0; i < idxOfNounsAndVerbs.length - 1; i++) {
      links.push({ source: idxOfNounsAndVerbs[i], target: idxOfNounsAndVerbs[i + 1], strength: 0.2, kind: 'samePOSWeak' });
    }
  }

  ctx.font = `${wordPx}px Newsreader`;

  const linkForce = forceLink<WordNode, WordLink>(links)
    .strength(d => d.strength ?? 0.08)
    .distance(d => {
      const s = (typeof d.source === 'number') ? nodes[d.source] : d.source;
      const t = (typeof d.target === 'number') ? nodes[d.target] : d.target;

      const rs = s?.r ?? 12;
      const rt = t?.r ?? 12;
      const base = rs + rt;

      const wS = s?.wPx ?? Math.ceil(ctx.measureText(s?.raw ?? '').width);
      const wT = t?.wPx ?? Math.ceil(ctx.measureText(t?.raw ?? '').width);
      const avgW = 0.3 * (wS + wT);

      const extra = Math.min(base * 0.9, avgW * 0.35);
      const adjustedBase = base + extra;

      if (d.kind === 'samePOS') return adjustedBase * 0.50;
      if (d.kind === 'samePOSWeak') return adjustedBase * 0.85;
      if (d.kind === 'punct') return adjustedBase * 0.95;
      if (d.kind === 'order') return adjustedBase * 0.05;
      return adjustedBase * 0.65;
    })
    .id((_, i) => i);

  const sentForce = sentenceCenterForce(sentCenters, SENT_STRENGTH);

  const sim = forceSimulation<WordNode>(nodes)
    .force('charge', forceManyBody<WordNode>().strength(CHARGE_STRENGTH))
    .force('collide', forceCollide<WordNode>().radius(d => d.r).iterations(2))
    .force('link', linkForce)
    .force('sent', sentForce)
    .alpha(0.9)
    .alphaDecay(0.03)
    .stop();

  // Keep containment as a force so manual, bounded tick sequences can share
  // the same geometry without starting D3's independent timer.
  sim.force('contain', (alpha: number) => {
    for (const n of nodes) {
      const nx = n.x ?? parEllipse.x;
      const ny = n.y ?? parEllipse.y;
      const cl = clampEllipse(
        nx,
        ny,
        parEllipse.x,
        parEllipse.y,
        parEllipse.rx,
        parEllipse.ry,
        n.r,
      );
      n.vx = (n.vx ?? 0) + (cl.x - nx) * CLAMP_PUSH * alpha;
      n.vy = (n.vy ?? 0) + (cl.y - ny) * CLAMP_PUSH * alpha;
    }
  });

  return { nodes, links, sim };
}
