'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  Simulation,
  SimulationLinkDatum
} from 'd3-force';
import { tightPack, placeEllipsesRectPacked, ellipseSizeFromWords } from './helpers/paragraphHelpers';
import { posBucket, POSBucket, tokenizePreservePunct } from './helpers/posHelpers';
import { 
  drawRadialGraph, 
  punctToASCIIStar, 
  drawBackgroundGrid,
  drawHeader,
  drawWrappedColumns,
  drawAsciiParticles
 } from './helpers/drawHelpers';

type CanvasProps = {
  passageText: string;
  passageHeader: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgRef: React.RefObject<HTMLCanvasElement | null>;
};

const MARGIN = 20;
const BG_SIDE_MARGIN = 40;
const BG_TOP_MARGIN = 100;
const BG_BOTTOM_MARGIN = 300;
const BG_WIDTH = 2000 + 2 * BG_SIDE_MARGIN;
const BG_HEIGHT = 2800 + BG_TOP_MARGIN + BG_BOTTOM_MARGIN;
const WORD_SIZE = 24;

const WIDTH = 2000;
const HEIGHT = 2800;
// inner drawing area
const INNER_X = BG_SIDE_MARGIN;
const INNER_Y = BG_TOP_MARGIN;

const CANVAS_FAMILY = 'Newsreader';
const NORMAL_WEIGHT = 400;

function fontString(opts: { italic?: boolean; weight?: number; size?: number; family?: string }) {
  const style  = opts.italic ? 'italic' : 'normal';
  const weight = (opts.weight ?? NORMAL_WEIGHT).toString();
  const size   = `${opts.size ?? WORD_SIZE}px`;
  const fam    = opts.family ?? CANVAS_FAMILY;
  // Canvas font shorthand: [style] [variant?] [weight] [size] [family]
  return `${style} ${weight} ${size} ${fam}`;
}

function normalFont() {return fontString({ weight: 300 })};
function firstWordFont() {return fontString({ italic: true, weight: 700, size: WORD_SIZE + 4 })};
function nounFont() {return fontString({ weight: 600 })};
function verbFont() {return fontString({})};
function adjectiveFont() {return fontString({ italic: true })};

function headerFont() {return fontString({ weight: 500, italic: true, size: WORD_SIZE + 20 })};

type EllipsePlacement = { x: number; y: number; rx: number; ry: number };

type WordNode = {
  x?: number; y?: number; vx?: number; vy?: number;
  text: string;          // token text (word or punctuation, e.g. ",")
  raw: string;           // original token string
  punctOnly: boolean;    // true for punctuation tokens (comma, dash, etc.)
  p: number; s: number; w: number; // paragraph/sentence/word indices
  r: number;             // collision radius
  scale: number;
  bucket: POSBucket;
};

type WordLinkKind = 'order' | 'samePOS' | 'samePOSWeak' | 'punct';

type WordLink = SimulationLinkDatum<WordNode> & {
  source: number | WordNode;
  target: number | WordNode;
  strength?: number;
  kind: WordLinkKind;
};

type SentenceCenter = { x: number; y: number; r: number; p: number; s: number };

function pxFromFontPx(px: number) { return px; }

// keep circle fully inside ellipse
function clampEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number, r: number) {
  const rxIn = Math.max(1, rx - r), ryIn = Math.max(1, ry - r);
  const u = (x - cx) / rxIn, v = (y - cy) / ryIn;
  const d2 = u * u + v * v; if (d2 <= 1) return { x, y };
  const s = 1 / Math.sqrt(d2 || 1);
  return { x: cx + u * s * rxIn, y: cy + v * s * ryIn };
}

// sentence centers
function sunflower(n: number, cx: number, cy: number, rx: number, ry: number) {
  const out: { x: number; y: number }[] = []; const phi = (1 + Math.sqrt(5)) / 2;
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / (n + 0.5));
    const a = 2 * Math.PI * k / (phi * phi);
    out.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) });
  }
  return out;
}

function computeSentenceCenters(
  ctx: CanvasRenderingContext2D,
  paragraphSentences: string[],
  par: EllipsePlacement,
  fontPx: number
): SentenceCenter[] {
  const baseGap = Math.round(pxFromFontPx(fontPx) * 0.45);
  const lineH = Math.round(pxFromFontPx(fontPx) * 1.2);
  const areas = paragraphSentences.map(s => {
    const tokens = tokenizePreservePunct(s);
    return Math.max(1, tokens.reduce((acc, t) => {
      const w = Math.ceil(ctx.measureText(t).width) + baseGap;
      const h = lineH;
      return acc + w * h;
    }, 0));
  });
  const totalArea = areas.reduce((a, b) => a + b, 0);
  const targetFill = 0.36;
  const targetArea = targetFill * Math.PI * par.rx * par.ry;
  const scale = Math.sqrt(targetArea / Math.max(1, totalArea));
  const radii = areas.map(a => Math.sqrt((a * scale * scale) / Math.PI) * 0.8 + 12);
  const seeds = sunflower(paragraphSentences.length, par.x, par.y, par.rx * 0.9, par.ry * 0.9);
  const centers: SentenceCenter[] = radii.map((r, i) => ({ x: seeds[i].x, y: seeds[i].y, r, p: 0, s: i }));

  //sort by left/right and top/bottom for better initial distribution
    centers.sort((a, b) => {
    const ax = a.x - par.x, ay = a.y - par.y;   
    const bx = b.x - par.x, by = b.y - par.y;
    const aAngle = Math.atan2(ay, ax);
    const bAngle = Math.atan2(by, bx);
    return aAngle - bAngle;
    });

  // separate & clamp
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

// sentence center gravity
function sentenceCenterForce(centers: SentenceCenter[], strength = 0.10) {
  const byPS = new Map<string, SentenceCenter>();
  for (const c of centers) byPS.set(`${c.p}:${c.s}`, c);

  function force(alpha: number) {
    const self = force as unknown as { nodes?: WordNode[] };
    const nodes = self.nodes ?? [];
    const k = strength * alpha;
    for (const n of nodes) {
      const key = `${n.p}:${n.s}`;
      const c = byPS.get(key);
      if (!c) continue;
      const nx = n.x ?? c.x, ny = n.y ?? c.y;
      const dx = c.x - nx, dy = c.y - ny;
      const dist = Math.hypot(dx, dy) || 1;
      const inside = dist < c.r;
      const f = inside ? k * 0.6 : k * 1.25;
      n.vx = (n.vx ?? 0) + (dx / dist) * f;
      n.vy = (n.vy ?? 0) + (dy / dist) * f;
    }
  }
  force.initialize = (nodes: WordNode[]) => {
    (force as unknown as { nodes?: WordNode[] }).nodes = nodes;
  }
  return force as unknown as (alpha: number) => void;
}

export default function DrawCanvas({ passageText, passageHeader, canvasRef, bgRef }: CanvasProps) {
  // paragraphs → sentences
  const structure = useMemo(() => {
    const paragraphs = passageText
        .split('\n')
        .map(p => p.trim())
        .filter(Boolean);

    return paragraphs.map(p =>
        (p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p]).map(s => s.trim()).filter(Boolean)
    );
  }, [passageText]);

  // paragraph sizes
  const sizes = useMemo(() => {
    return structure.map(sentences => {
      const wc = sentences.reduce((a, s) => a + (tokenizePreservePunct(s).filter(t => !/^[,.;:!?—–\-()"'`]+$/.test(t)).length), 0);
      return ellipseSizeFromWords(wc, WIDTH - 2 * MARGIN, { minS: 220, maxS: 700, mix: 0.1 });
    });
  }, [structure]);


useEffect(() => {
  const fg = canvasRef.current;  if (!fg) return;
  const ctx = fg.getContext('2d'); if (!ctx) return;

  const bg = bgRef.current; if (!bg) return;
  const bgctx = bg.getContext('2d'); if (!bgctx) return;

  // Ensure the background buffer matches your BG constants
  if (bg.width !== BG_WIDTH)  bg.width  = BG_WIDTH;
  if (bg.height !== BG_HEIGHT) bg.height = BG_HEIGHT;

  // Inner panel geometry (content region)
  const IX = INNER_X;            // BG_SIDE_MARGIN
  const IY = INNER_Y;            // BG_TOP_MARGIN
  const IW = WIDTH;              // content width
  const IH = HEIGHT;             // content height

  const placeW = IW - 2 * MARGIN;
  const placeH = IH - 2 * MARGIN;

  const packed = tightPack(
    WIDTH - 2 * MARGIN,
    HEIGHT - 2 * MARGIN,
    sizes,
    { gridStep: 20, areaSlack: 0.78, orderBias: 0.25, edgeBias: 0.08 },
    0.58,
    18,
    1.0015
  );

  if (packed === "FAIL") {
    ctx.save();
    ctx.fillStyle = '#b00020';
    ctx.font = '16px Newsreader';
    ctx.fillText('Content cannot fit even at minimum scale.', 20, 32);
    ctx.restore();
    return;
  }

  // const placement = placeEllipsesRectPacked(
  //   placeW,
  //   placeH,
  //   sizes,
  //   { gridStep: 20, areaSlack: 0.78, orderBias: 0.25, edgeBias: 0.08 }
  // );
  const { placement, k: globalScale } = packed;

  // if (placement === 'TOO_LARGE') {
  //   ctx.save();
  //   ctx.fillStyle = '#b00020';
  //   ctx.font = '16px Newsreader';
  //   ctx.fillText('Paragraphs too large to place without overlap.', 20, 32);
  //   ctx.restore();
  //   return;
  // }

  // Shift from local (0..placeW/H) into the inner panel with padding
  const shifted = placement.map(e => ({
    x: e.x + IX + MARGIN,
    y: e.y + IY + MARGIN,
    rx: e.rx,
    ry: e.ry
  }));

  // paint background
  bgctx.save();
  bgctx.clearRect(0, 0, bg.width, bg.height);
  //outside
  bgctx.fillStyle = 'white';
  bgctx.fillRect(0, 0, bg.width, bg.height);

  drawBackgroundGrid(bgctx, IX, IY, IW, IH, 25, 0.4, 'rgba(255,255,255,0.4)');

  // noise overlay
  const noise = new Image();
  noise.src = '/noisy.png';
  const paintNoise = () => {
    const pat = bgctx.createPattern(noise, 'repeat');
    if (!pat) return;
    bgctx.save();
    bgctx.globalAlpha = 0.7;
    bgctx.fillStyle = pat;
    bgctx.fillRect(IX, IY, IW, IH);
    bgctx.restore();
  };
  noise.onload = paintNoise;

  // paragraph connectors
  bgctx.strokeStyle = 'white';
  bgctx.lineWidth = 1;
  bgctx.setLineDash([1, 1]);
  for (let i = 0; i < shifted.length - 1; i++) {
    bgctx.beginPath();
    bgctx.moveTo(shifted[i].x, shifted[i].y);
    bgctx.lineTo(shifted[i + 1].x, shifted[i + 1].y);
    bgctx.stroke();
  }
  bgctx.setLineDash([]);

  for (let index = 0; index < shifted.length; index++) {
    const e = shifted[index];
    drawRadialGraph(bgctx, e.x, e.y, e.rx, e.ry, index);
  }

  drawAsciiParticles(bgctx, IX, IY, IW, IH, {avoid: shifted});

  //clean by filling area outside canvas with white
  bgctx.fillRect(0, 0, bg.width, IY);
  bgctx.fillRect(0, IY + IH, bg.width, bg.height - (IY + IH));
  bgctx.fillRect(0, 0, IX, bg.height);
  bgctx.fillRect(IX + IW, 0, bg.width - (IX + IW), bg.height);

  //draw header on top
  drawHeader(bgctx, passageHeader, BG_SIDE_MARGIN + MARGIN, BG_TOP_MARGIN / 2, {
    font: headerFont(),
    color: '#000',
  });

  drawWrappedColumns(bgctx, passageText, {
    x: BG_SIDE_MARGIN + MARGIN,
    y: BG_TOP_MARGIN + IH + 40,
    width: IW - 2 * MARGIN,
    height: (BG_BOTTOM_MARGIN - 80),
    columns: 4,
    columnGap: 40,
    font: normalFont(),
    color: '#000',
  });

  bgctx.restore();

    // draw frame closure
    const paragraphNodes: WordNode[][] = [];
    const paragraphLinks: WordLink[][] = [];

    const drawFrame = () => {
      ctx.clearRect(0, 0, fg.width, fg.height);

      // links - dotted for punctuation
      for (const links of paragraphLinks) {
        for (const L of links) {
          const s = (typeof L.source === 'number' ? null : L.source) as WordNode | null;
          const t = (typeof L.target === 'number' ? null : L.target) as WordNode | null;
          if (!s || !t) continue;

          const dotted = L.kind === 'punct' || s.punctOnly || t.punctOnly;
          if (dotted) {
            ctx.strokeStyle = 'rgba(255,255,255,0.50)';
            (ctx).setLineDash?.([3, 3]);
          } else if (L.kind === 'samePOSWeak') {
            ctx.strokeStyle = 'rgba(255,255,255,0.50)'; // very faint
            (ctx).setLineDash?.([]);
          } else if (L.kind === 'samePOS') {
            ctx.strokeStyle = 'rgba(255,255,255,0.0.50)';
            (ctx).setLineDash?.([]);
          } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.50)';
            (ctx).setLineDash?.([]);
          }

          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo((s.x ?? 0), (s.y ?? 0));
          ctx.lineTo((t.x ?? 0), (t.y ?? 0));
          ctx.stroke();
        }
      }
      (ctx).setLineDash?.([]);

      // words
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
        for (const nodes of paragraphNodes) {
            for (const n of nodes) {
                // switch font per node
                if (n.w === 0 && !n.punctOnly) {
                    ctx.font = firstWordFont();
                } else if (n.bucket === 'ADJ') {
                    ctx.font = adjectiveFont();
                } else if (n.bucket === 'NOUN') {
                    ctx.font = nounFont();
                } else if (n.bucket === 'VERB') {
                    ctx.font = verbFont();
                } else {
                    ctx.font = normalFont();
                }
                ctx.fillStyle = 'white';
                if (n.punctOnly) {
                  ctx.fillText(punctToASCIIStar(n.text), n.x ?? 0, n.y ?? 0);
                } else {
                  ctx.fillText(n.text, n.x ?? 0, n.y ?? 0);
                }
            }
        }
    };
    

    // per-paragraph simulation build
    const fontPx = WORD_SIZE;
    ctx.font = `${fontPx}px Newsreader`;
    const baseGap = Math.round(pxFromFontPx(fontPx) * 0.45);
    const lineH = Math.round(pxFromFontPx(fontPx) * 1.2);

    const sims: Array<Simulation<WordNode, undefined>> = [];

    for (let p = 0; p < structure.length; p++) {
      const parEllipse: EllipsePlacement = {
        x: placement[p].x + MARGIN, y: placement[p].y + MARGIN,
        rx: placement[p].rx, ry: placement[p].ry
      };

      const sentCenters = computeSentenceCenters(ctx, structure[p], parEllipse, fontPx)
        .map((c, sIdx) => ({ ...c, p, s: sIdx }));

      const nodes: WordNode[] = [];
      const links: WordLink[] = [];

      for (let s = 0; s < structure[p].length; s++) {
        const sentence = structure[p][s];
        const tokens = tokenizePreservePunct(sentence); // <-- commas split out
        const c = sentCenters[s];

        const idxOfNounsAndVerbs: number[] = [];

        let prevIdx: number | null = null;

        for (let w = 0; w < tokens.length; w++) {
          const raw = tokens[w];
          const punctOnly = /^[,.;:!?—–\-()"'`]+$/.test(raw);
          const bucket = posBucket(raw);

          const width = Math.ceil(ctx.measureText(raw).width) + baseGap;
          const height = lineH;
          const r = 0.5 * Math.hypot(width, height);

          // seed in order left to right top to bottom
          const jitter = 4;
            const x = c.x - c.r + (c.r * 2) * ((w + 1) / (tokens.length + 1)) + (Math.random() * 2 - 1) * jitter;
            const y = c.y + (Math.random() * 2 - 1) * jitter;

          const nodeIndex = nodes.length;
          nodes.push({
            x, y, vx: 0, vy: 0,
            text: raw, raw,
            punctOnly, p, s, w, r, scale: 1.0, bucket
          });

          if (bucket === 'NOUN' || bucket === 'VERB') idxOfNounsAndVerbs.push(nodeIndex);

          // order link to previous token (punctuation included)
          if (prevIdx !== null) {
            const prev = nodes[prevIdx];
            const kind: WordLinkKind = (prev.punctOnly || punctOnly) ? 'punct' : 'order';
            if (kind === 'punct') { 
            links.push({
              source: prevIdx,
              target: nodeIndex,
              strength: 0.05,
              kind
            })
            ;
            }
            // immediate same-POS (stronger) when both non-punct and both NOUN or both VERB
            if (!prev.punctOnly && !punctOnly) {
              if ((prev.bucket === 'NOUN' && bucket === 'NOUN') ||
                  (prev.bucket === 'VERB' && bucket === 'VERB')) {
                links.push({
                  source: prevIdx,
                  target: nodeIndex,
                  strength: 0.10,
                  kind: 'samePOS'
                });
              }
            }
          }

          prevIdx = nodeIndex;
        }

        // EXTRA very weak links between consecutive nouns and verbs
        for (let i = 0; i < idxOfNounsAndVerbs.length - 1; i++) {
          links.push({
            source: idxOfNounsAndVerbs[i],
            target: idxOfNounsAndVerbs[i + 1],
            strength: 0.2,          // very weak
            kind: 'samePOSWeak'
          });
        }
      }

      // link force w/ distances per kind
      const linkForce = forceLink<WordNode, WordLink>(links)
        .strength(d => d.strength ?? 0.08)
        .distance(d => {
          const s = (typeof d.source === 'number') ? nodes[d.source] : d.source;
          const t = (typeof d.target === 'number') ? nodes[d.target] : d.target;
          const rs = s?.r ?? 12, rt = t?.r ?? 12;
          const base = (rs + rt);
          if (d.kind === 'samePOS')     return base * 0.50;
          if (d.kind === 'samePOSWeak') return base * 0.85; // longer & gentler
          if (d.kind === 'punct')       return base * 0.95; // the loosest, dotted
          return base * 0.65;                                // normal order
        })
        .id((_, i) => i);

      const sentForce = sentenceCenterForce(sentCenters, 0.20);

      const sim = forceSimulation<WordNode>(nodes)
        .force('charge', forceManyBody<WordNode>().strength(-18))
        .force('collide', forceCollide<WordNode>().radius(d => d.r).iterations(2))
        .force('link', linkForce)
        .force('sent', sentForce)
        .on('tick', () => {
          for (const n of nodes) {
            const nx = n.x ?? parEllipse.x, ny = n.y ?? parEllipse.y;
            const cl = clampEllipse(nx, ny, parEllipse.x, parEllipse.y, parEllipse.rx, parEllipse.ry, n.r);
            n.vx = (n.vx ?? 0) + (cl.x - nx) * 0.4;
            n.vy = (n.vy ?? 0) + (cl.y - ny) * 0.4;
            n.x = cl.x; n.y = cl.y;
          }
          drawFrame();
        })
        .alpha(0.9)
        .alphaDecay(0.03);

      sims.push(sim);
      paragraphNodes.push(nodes);
      paragraphLinks.push(links);
    }

    // first paint
    drawFrame();

    // cleanup
    return () => { sims.forEach(s => s.stop()); };
  }, [sizes, structure, passageHeader, passageText]);

  return (
    <div className='relative flex justify-center items-center w-[100svw] h-[90svh]'>
    <canvas
      ref={canvasRef}
      className="absolute z-[6]"
      style={{ width: '50svh', height: '70svh', top: '7svh'}}
      width={WIDTH}
      height={HEIGHT}
    />
    <canvas
      ref={bgRef}
      className="absolute z-[1]"
      style={{ width: '54svh', height: '84svh' }}
      width={BG_WIDTH}
      height={BG_HEIGHT}
    />
    </div>
  );
}
