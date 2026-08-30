// sentenceHelpers.ts
import { forceSimulation, forceManyBody, forceLink, forceCollide, SimulationLinkDatum, Simulation } from 'd3-force';
import type { POSBucket } from './posHelpers';
import { punctToASCIIStar } from './drawHelpers';
import {
  COMPOSITION_PRESETS,
  type CompositionDynamics,
} from '../settings/compositionPresets';

export type EllipsePlacement = { x: number; y: number; rx: number; ry: number };

export type WordNode = {
  x?: number; y?: number; vx?: number; vy?: number;
  wPx: number;
  collisionRx: number;
  collisionRy: number;
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
  const punctuationFont = () => fontString({
    family: '"Star Glyphs", Newsreader, serif',
    size: wordPx,
  });

  return {
    normalFont,
    firstWordFont,
    nounFont,
    verbFont,
    adjectiveFont,
    headerFont,
    punctuationFont,
  };
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

export function clampGlyphToEllipse(
  node: WordNode,
  ellipse: EllipsePlacement,
) {
  const x = node.x ?? ellipse.x;
  const y = node.y ?? ellipse.y;
  const u = (x - ellipse.x) / Math.max(1, ellipse.rx);
  const v = (y - ellipse.y) / Math.max(1, ellipse.ry);
  const radialDistance = Math.hypot(u, v);
  if (radialDistance < 0.0001) return { x, y };
  const angle = Math.atan2(v, u);
  const a = node.collisionRx / Math.max(1, ellipse.rx);
  const b = node.collisionRy / Math.max(1, ellipse.ry);
  const projection = a * Math.abs(Math.cos(angle)) + b * Math.abs(Math.sin(angle));
  const discriminant = projection * projection + 1 - a * a - b * b;
  const radialLimit = Math.max(0, -projection + Math.sqrt(Math.max(0, discriminant)));
  if (radialDistance <= radialLimit) return { x, y };
  const scale = radialLimit / radialDistance;
  return {
    x: ellipse.x + u * scale * ellipse.rx,
    y: ellipse.y + v * scale * ellipse.ry,
  };
}

export function countGlyphOverlaps(nodes: WordNode[], padding = 2) {
  let overlaps = 0;
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const a = nodes[first];
      const b = nodes[second];
      const overlapX = a.collisionRx + b.collisionRx + padding
        - Math.abs((b.x ?? 0) - (a.x ?? 0));
      const overlapY = a.collisionRy + b.collisionRy + padding
        - Math.abs((b.y ?? 0) - (a.y ?? 0));
      if (overlapX > 0 && overlapY > 0) overlaps += 1;
    }
  }
  return overlaps;
}

export function resolveGlyphOverlaps(
  nodes: WordNode[],
  passes = 64,
) {
  let clean = true;
  for (let pass = 0; pass < passes; pass += 1) {
    let overlapCount = 0;
    for (let first = 0; first < nodes.length; first += 1) {
      for (let second = first + 1; second < nodes.length; second += 1) {
        const a = nodes[first];
        const b = nodes[second];
        const ax = a.x ?? 0;
        const ay = a.y ?? 0;
        const bx = b.x ?? 0;
        const by = b.y ?? 0;
        const dx = bx - ax;
        const dy = by - ay;
        const overlapX = a.collisionRx + b.collisionRx + 2 - Math.abs(dx);
        const overlapY = a.collisionRy + b.collisionRy + 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        overlapCount += 1;
        if (overlapX < overlapY) {
          const direction = dx === 0 ? ((first + second) % 2 ? 1 : -1) : Math.sign(dx);
          const push = overlapX * 0.52 * direction;
          a.x = ax - push;
          b.x = bx + push;
        } else {
          const direction = dy === 0 ? ((first + second) % 2 ? -1 : 1) : Math.sign(dy);
          const push = overlapY * 0.52 * direction;
          a.y = ay - push;
          b.y = by + push;
        }
      }
    }
    clean = overlapCount === 0;
    if (clean) break;
  }
  return clean;
}

function pxFromFontPx(px: number) {
  return px;
}

export function computeSentenceCentersFromTokens(
  ctx: CanvasRenderingContext2D,
  sentenceTokens: string[][],
  par: EllipsePlacement,
  fontPx: number,
  radiusScale = 1,
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

  const radii = areas.map(
    a => (Math.sqrt((a * scale * scale) / Math.PI) * 0.8 + 12) * radiusScale,
  );

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
  dynamics?: CompositionDynamics;
}): { nodes: WordNode[]; links: WordLink[]; sim: Simulation<WordNode, undefined> } {
  const {
    ctx,
    sentences,
    paragraphIndex: p,
    parEllipse,
    wordPx,
    tokenizeAndBucket,
    random = Math.random,
    dynamics = COMPOSITION_PRESETS.baseline.dynamics,
  } = args;

  const BASE_WORD = 24;
  const fieldMode = dynamics.fieldGravity > 0;
  const kWord = Math.max(0.5, Math.min(2.0, wordPx / BASE_WORD));
  const PAD = Math.max(1, Math.round(0.22 * wordPx * dynamics.collisionPadding));
  const JITTER = Math.max(1, Math.round(4 * kWord));

  const SENT_STRENGTH = 0.20 * dynamics.sentenceAttraction * (1 / (kWord ** 0.3));
  const CHARGE_STRENGTH = fieldMode
    ? -22 * dynamics.repulsion * (kWord ** 2)
    : -18 * dynamics.repulsion * (1 / (kWord ** 0.3));
  const CLAMP_PUSH = 0.4 * dynamics.containment * (1 / kWord);

  ctx.font = `${wordPx}px Newsreader`;
  const baseGap = Math.round(pxFromFontPx(wordPx) * 0.45) + Math.round(PAD * 0.6);
  const lineH = Math.round(pxFromFontPx(wordPx) * 1.2);

  // tag+tokenize once
  const tagged = sentences.map(tokenizeAndBucket);
  const sentenceTokens = tagged.map(t => t.tokens);

  const sentCenters = computeSentenceCentersFromTokens(
    ctx,
    sentenceTokens,
    parEllipse,
    wordPx,
    dynamics.sentenceRadius,
  )
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
      const measurementFont = punctOnly
        ? fontString({ size: wordPx, family: '"Star Glyphs", Newsreader, serif' })
        : isFirstInSentence
          ? fontString({ italic: true, weight: 700, size: wordPx + 4, family: 'Newsreader' })
          : bucket === 'ADJ'
            ? fontString({ italic: true, size: wordPx, family: 'Newsreader' })
            : bucket === 'NOUN'
              ? fontString({ weight: 600, size: wordPx, family: 'Newsreader' })
              : fontString({ size: wordPx, family: 'Newsreader' });
      ctx.font = measurementFont;
      const renderedText = punctOnly ? punctToASCIIStar(raw) : raw;
      const wPx = Math.ceil(ctx.measureText(renderedText).width);
      const width = wPx + baseGap;
      const height = isFirstInSentence ? lineH + 4 : lineH;
      // Collision follows the drawn label's axis-aligned footprint. A
      // diagonal radius overestimates every word and makes dense fixed
      // compositions needlessly expensive to settle.
      const r = Math.max(width * 0.5, height * 0.5) + PAD;
      const collisionRx = width * 0.5 + PAD;
      const collisionRy = height * 0.5 + PAD;

      const nodeIndex = nodes.length;
      const sentenceX = c.x - c.r + (c.r * 2) * ((w + 1) / (tokens.length + 1));
      const sentenceY = c.y;
      const jitter = fieldMode ? JITTER * 3 : JITTER;
      const x = sentenceX + (random() * 2 - 1) * jitter;
      const y = sentenceY + (random() * 2 - 1) * jitter;

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
        collisionRx,
        collisionRy,
      });

      if (w == 0 || bucket === 'NOUN' || bucket === 'VERB' || bucket === 'PRON') idxOfNounsAndVerbs.push(nodeIndex);

      if (prevIdx !== null) {
        const prev = nodes[prevIdx];
        const kind: WordLinkKind = (prev.punctOnly || punctOnly) ? 'punct' : 'order';

        if (kind === 'punct') {
          //punctuation link
          links.push({
            source: prevIdx,
            target: nodeIndex,
            strength: 0.05 * dynamics.orderCohesion,
            kind,
          });
        } else {
          //normal order
          links.push({
            source: prevIdx,
            target: nodeIndex,
            strength: 0.005 * dynamics.orderCohesion,
            kind: 'order',
          });
        }

        if (!prev.punctOnly && !punctOnly) {
          if ((prev.bucket === 'NOUN' && bucket === 'NOUN') || (prev.bucket === 'VERB' && bucket === 'VERB')) {
            links.push({
              source: prevIdx,
              target: nodeIndex,
              strength: 0.10 * dynamics.posCohesion,
              kind: 'samePOS',
            });
          }
        }
      }

      prevIdx = nodeIndex;
    }

    for (let i = 0; i < idxOfNounsAndVerbs.length - 1; i++) {
      links.push({
        source: idxOfNounsAndVerbs[i],
        target: idxOfNounsAndVerbs[i + 1],
        strength: 0.2 * dynamics.posCohesion,
        kind: 'samePOSWeak',
      });
    }
  }

  ctx.font = `${wordPx}px Newsreader`;

  const linkForce = forceLink<WordNode, WordLink>(links)
    .strength((link) => {
      if (!fieldMode) return link.strength ?? 0.08;
      if (link.kind === 'punct') return 0.2;
      if (link.kind === 'order') return 0.09;
      return 0;
    })
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

      if (fieldMode) {
        const glyphSpan = (s?.collisionRx ?? rs) + (t?.collisionRx ?? rt);
        if (d.kind === 'punct') return glyphSpan + wordPx * 0.35;
        if (d.kind === 'order') return glyphSpan + wordPx * 4;
        return glyphSpan + wordPx;
      }

      if (d.kind === 'samePOS') return adjustedBase * 0.50;
      if (d.kind === 'samePOSWeak') return adjustedBase * 0.85;
      if (d.kind === 'punct') return adjustedBase * 0.95;
      if (d.kind === 'order') return adjustedBase * 0.05;
      return adjustedBase * 0.65;
    })
    .id((_, i) => i)
    .iterations(fieldMode ? 2 : 1);

  const sentForce = sentenceCenterForce(sentCenters, SENT_STRENGTH);
  const chargeForce = forceManyBody<WordNode>()
    .strength((node) => CHARGE_STRENGTH * (fieldMode && node.punctOnly ? 0.25 : 1));
  if (fieldMode) {
    chargeForce
      .distanceMin(Math.max(8, wordPx * 1.25))
      .distanceMax(Math.max(parEllipse.rx, parEllipse.ry) * 1.5);
  }

  const sim = forceSimulation<WordNode>(nodes)
    .randomSource(random)
    .force('charge', chargeForce)
    .force('collide', forceCollide<WordNode>().radius(d => d.r).iterations(2))
    .force('link', linkForce)
    .alpha(fieldMode ? 1 : 0.9)
    .alphaDecay(fieldMode ? 0.045 : 0.03)
    .velocityDecay(fieldMode ? 0.42 : 0.4)
    .stop();
  if (!fieldMode) sim.force('sent', sentForce);

  // Field has no paragraph boundary: its sentence chains are allowed to drift
  // beyond their packed seed region. Other presets retain ellipse containment.
  if (!fieldMode) {
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
  }

  if (dynamics.edgeAttraction > 0) {
    sim.force('edge', (alpha: number) => {
      const strength = 0.9 * dynamics.edgeAttraction * alpha;
      for (const node of nodes) {
        const nx = node.x ?? parEllipse.x;
        const ny = node.y ?? parEllipse.y;
        const dx = nx - parEllipse.x;
        const dy = ny - parEllipse.y;
        const distance = Math.hypot(dx, dy) || 1;
        const normalized = Math.hypot(
          dx / Math.max(1, parEllipse.rx - node.r),
          dy / Math.max(1, parEllipse.ry - node.r),
        );
        if (normalized >= 0.76) continue;
        const push = (0.76 - normalized) * strength;
        node.vx = (node.vx ?? 0) + (dx / distance) * push;
        node.vy = (node.vy ?? 0) + (dy / distance) * push;
      }
    });
  }

  return { nodes, links, sim };
}
