'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceSimulation } from 'd3-force';
import type { Simulation } from 'd3-force';

import { tightPack, ellipseSizeFromWords } from './helpers/paragraphHelpers';
import { tokenizeAndBucket } from './helpers/posHelpers';
import {
  drawAsciiParticles,
  drawBackgroundGrid,
  drawHeader,
  drawRadialGraph,
  drawWrappedColumns,
  punctToASCIIStar,
  DEEPBLUEGREEN_HEX
} from './helpers/drawHelpers';
import { FixedCanvasOption } from './settings/canvasOptions';
import { hashString, seededRandom } from './helpers/randomHelpers';

import {
  clampEllipse,
  makeFonts,
  buildParagraphSim,
  type EllipsePlacement,
  type WordLink,
  type WordNode,
} from './helpers/sentenceHelpers';

type CanvasProps = {
  passageText: string;
  passageHeader: string;
  canvasOption: FixedCanvasOption;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgRef: React.RefObject<HTMLCanvasElement | null>;
  onReadyChange?: (ready: boolean) => void;
};

const imagePromises = new Map<string, Promise<HTMLImageElement | null>>();

function loadCanvasImage(src: string) {
  const cached = imagePromises.get(src);
  if (cached) return cached;
  const promise = (async () => {
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          image.onload = null;
          image.onerror = null;
          resolve();
        };
        const fail = () => {
          image.onload = null;
          image.onerror = null;
          reject(new Error(`Unable to load ${src}`));
        };
        image.onload = finish;
        image.onerror = fail;
        image.src = src;
        if (image.complete) {
          if (image.naturalWidth > 0) finish();
          else fail();
        }
      });
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch {
          if (!image.naturalWidth) throw new Error(`Unable to decode ${src}`);
        }
      }
      return image;
    } catch {
      imagePromises.delete(src);
      return null;
    }
  })();
  imagePromises.set(src, promise);
  return promise;
}

type CollisionGroup = {
  ellipse: EllipsePlacement;
  nodes: WordNode[];
};

type CollisionBounds = {
  width: number;
  height: number;
  padding: number;
};

type CollisionPoint = {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
  r: number;
};

function clampGroup(group: CollisionGroup) {
  for (const node of group.nodes) {
    const x = node.x ?? group.ellipse.x;
    const y = node.y ?? group.ellipse.y;
    const clamped = clampEllipse(
      x,
      y,
      group.ellipse.x,
      group.ellipse.y,
      group.ellipse.rx,
      group.ellipse.ry,
      node.r,
    );
    node.x = clamped.x;
    node.y = clamped.y;
  }
}

function clampToCanvas(node: WordNode, bounds: CollisionBounds) {
  const inset = node.r + bounds.padding;
  node.x = Math.min(
    Math.max(inset, node.x ?? bounds.width / 2),
    Math.max(inset, bounds.width - inset),
  );
  node.y = Math.min(
    Math.max(inset, node.y ?? bounds.height / 2),
    Math.max(inset, bounds.height - inset),
  );
}

/**
 * One conservative circle-collision field spans every fixed-format region.
 * Nodes may cross their original region boundary while settling, so a nearby
 * paragraph can always yield space instead of allowing labels to overlap.
 */
function resolveGlobalWordCollisions(
  groups: CollisionGroup[],
  bounds: CollisionBounds,
  passes = 2,
) {
  const entries = groups.flatMap((group) =>
    group.nodes.map((node) => ({ group, node })),
  );
  for (let pass = 0; pass < passes; pass += 1) {
    let overlapCount = 0;
    for (let first = 0; first < entries.length; first += 1) {
      const a = entries[first];
      for (let second = first + 1; second < entries.length; second += 1) {
        const b = entries[second];
        const ax = a.node.x ?? a.group.ellipse.x;
        const ay = a.node.y ?? a.group.ellipse.y;
        const bx = b.node.x ?? b.group.ellipse.x;
        const by = b.node.y ?? b.group.ellipse.y;
        let dx = bx - ax;
        let dy = by - ay;
        let distance = Math.hypot(dx, dy);
        const minimum = a.node.r + b.node.r + 2;
        if (distance >= minimum) continue;
        overlapCount += 1;
        if (distance < 0.001) {
          const angle = ((first * 31 + second * 17) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (minimum - distance) * 0.5;
        const unitX = dx / distance;
        const unitY = dy / distance;
        a.node.x = ax - unitX * push;
        a.node.y = ay - unitY * push;
        b.node.x = bx + unitX * push;
        b.node.y = by + unitY * push;
      }
    }
    entries.forEach(({ node }) => clampToCanvas(node, bounds));
    if (overlapCount === 0) break;
  }
}

function countGlobalWordOverlaps(groups: CollisionGroup[]) {
  const nodes = groups.flatMap((group) => group.nodes);
  let overlaps = 0;
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const a = nodes[first];
      const b = nodes[second];
      const distance = Math.hypot(
        (b.x ?? 0) - (a.x ?? 0),
        (b.y ?? 0) - (a.y ?? 0),
      );
      if (distance + 0.25 < a.r + b.r + 2) overlaps += 1;
    }
  }
  return overlaps;
}

export default function DrawCanvas({
  passageText,
  passageHeader,
  canvasOption,
  canvasRef,
  bgRef,
  onReadyChange,
}: CanvasProps) {
  // scale view to wrapper
  const [scale, setScale] = useState(1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);

  const BG_WIDTH = canvasOption.W + 2 * canvasOption.BG_SIDE_MARGIN;
  const BG_HEIGHT = canvasOption.H + canvasOption.BG_TOP_MARGIN + canvasOption.BG_BOTTOM_MARGIN;

  //resize poster display to fit screen size
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const contentW = BG_WIDTH;
    const contentH = BG_HEIGHT;

    const compute = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const sx = r.width / contentW;
      const sy = r.height / contentH;
      setScale(Math.min(sx, sy, 1));
    };

    compute();

    const ro = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(compute);
    ro?.observe(el);
    window.addEventListener('resize', compute);
    window.visualViewport?.addEventListener('resize', compute);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', compute);
      window.visualViewport?.removeEventListener('resize', compute);
    };
  }, [BG_WIDTH, BG_HEIGHT]);

  //zoom in on mouse hover or touch drag
  useEffect(() => {
    const wrapperEl = wrapperRef.current;
    const zoomEl = zoomRef.current;
    if (!wrapperEl || !zoomEl) return;

    const targetScale = 3.0;

    let raf = 0;
    let lastX = 0;
    let lastY = 0;
    let hovering = false;

    const apply = () => {
      raf = 0;
      if (!hovering) return;

      const wrapperRect = wrapperEl.getBoundingClientRect();
      const stageEl = stageRef.current;
      if (!stageEl) return;
      const stageRect = stageEl.getBoundingClientRect();
      if (!wrapperRect.width || !wrapperRect.height || !stageRect.width || !stageRect.height) return;

      const mx = lastX - stageRect.left;
      const my = lastY - stageRect.top;

      // convert to unscaled poster coords (poster px)
      const ux = mx / scale;
      const uy = my / scale;

      // wrapper center expressed in *stage* coords (still poster px)
      const wrapperCenterX_inStagePx = (wrapperRect.left + wrapperRect.width / 2) - stageRect.left;
      const wrapperCenterY_inStagePx = (wrapperRect.top  + wrapperRect.height / 2) - stageRect.top;

      const cx = wrapperCenterX_inStagePx / scale;
      const cy = wrapperCenterY_inStagePx / scale;

      // translate in unscaled coords so (ux,uy) goes to wrapper center when scaled by targetScale
      let tx = cx - ux * targetScale;
      let ty = cy - uy * targetScale;

      // clamp so content stays covering the wrapper
      const minTx = (stageRect.width / scale) - (BG_WIDTH * targetScale);
      const minTy = (stageRect.height / scale) - (BG_HEIGHT * targetScale);

      tx = Math.min(0, Math.max(minTx, tx));
      ty = Math.min(0, Math.max(minTy, ty));

      zoomEl.style.transformOrigin = 'top left';
      zoomEl.style.transform = `translate(${tx}px, ${ty}px) scale(${targetScale})`;
    };

    const onMove = (e: MouseEvent) => {
      hovering = true;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onLeave = () => {
      hovering = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;

      // reset
      zoomEl.style.transformOrigin = 'top left';
      zoomEl.style.transform = `translate(0px, 0px) scale(1)`;
    };

    const onTouchMove = (e: TouchEvent) => {
      hovering = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onTouchEnd = () => {
      hovering = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;

      // reset
      zoomEl.style.transformOrigin = 'top left';
      zoomEl.style.transform = `translate(0px, 0px) scale(1)`;
    };

    wrapperEl.addEventListener('touchmove', onTouchMove, { passive: true });
    wrapperEl.addEventListener('touchend', onTouchEnd);
    wrapperEl.addEventListener('touchcancel', onTouchEnd);

    wrapperEl.addEventListener('mousemove', onMove);
    wrapperEl.addEventListener('mouseleave', onLeave);

    return () => {
      wrapperEl.removeEventListener('touchmove', onTouchMove);
      wrapperEl.removeEventListener('touchend', onTouchEnd);
      wrapperEl.removeEventListener('touchcancel', onTouchEnd);
      wrapperEl.removeEventListener('mousemove', onMove);
      wrapperEl.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [BG_WIDTH, BG_HEIGHT, scale]);


  const INNER_X = canvasOption.BG_SIDE_MARGIN;
  const INNER_Y = canvasOption.BG_TOP_MARGIN;

  // paragraphs -> sentences
  const structure = useMemo(() => {
    const paragraphs = passageText
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);

    return paragraphs.map((p) =>
      (p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p])
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [passageText]);

  // paragraph ellipse sizes
  const sizes = useMemo(() => {
    return structure.map((sentences) => {
      const wc = sentences.reduce(
        (total, sentence) => total + tokenizeAndBucket(sentence).tokens.length,
        0,
      );

      return ellipseSizeFromWords(
        wc,
        canvasOption.W - 2 * canvasOption.MARGIN,
        { minS: 220, maxS: 700, mix: 0.1 }
      );
    });
  }, [structure, canvasOption]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    const sims: Array<Simulation<WordNode, undefined>> = [];
    onReadyChange?.(false);

    const render = async () => {
      const fg = canvasRef.current;
      const bg = bgRef.current;
      const ctx = fg?.getContext('2d');
      const bgctx = bg?.getContext('2d');
      if (!fg || !bg || !ctx || !bgctx) return;

      try {
        const fontReady = document.fonts
          ? Promise.all([
              document.fonts.load(`${canvasOption.WORD_SIZE}px Newsreader`),
              document.fonts.ready,
            ])
          : Promise.resolve();
        const [, noise, compass] = await Promise.all([
          fontReady,
          loadCanvasImage('/noisy.png'),
          canvasOption.showText ? loadCanvasImage('/compass.png') : Promise.resolve(null),
        ]);
        if (cancelled) return;

        if (fg.width !== canvasOption.W) fg.width = canvasOption.W;
        if (fg.height !== canvasOption.H) fg.height = canvasOption.H;
        fg.dataset.wordOverlaps = 'settling';
        fg.dataset.renderStage = 'assets-ready';
        if (bg.width !== BG_WIDTH) bg.width = BG_WIDTH;
        if (bg.height !== BG_HEIGHT) bg.height = BG_HEIGHT;

        const IX = INNER_X;
        const IY = INNER_Y;
        const IW = canvasOption.W;
        const IH = canvasOption.H;
        const packed = tightPack(
          IW - 2 * canvasOption.MARGIN,
          IH - 2 * canvasOption.MARGIN,
          canvasOption.WORD_SIZE,
          sizes,
          {
            gridStep: Math.max(24, Math.round(canvasOption.WORD_SIZE * 1.5)),
            areaSlack: 0.78,
            orderBias: 0.25,
            edgeBias: 0.08,
          },
          0.58,
          10,
          1.0015,
        );

        if (packed === 'FAIL') {
          fg.dataset.renderStage = 'pack-failed';
          fg.dataset.wordOverlaps = 'not-rendered';
          bgctx.clearRect(0, 0, bg.width, bg.height);
          bgctx.fillStyle = 'white';
          bgctx.fillRect(0, 0, bg.width, bg.height);
          ctx.clearRect(0, 0, fg.width, fg.height);
          ctx.fillStyle = '#b00020';
          ctx.font = `${canvasOption.WORD_SIZE * 2}px Newsreader`;
          ctx.fillText('Content cannot fit, please enter a shorter passage.', 40, 100);
          onReadyChange?.(false);
          return;
        }

        const { placement } = packed;
        fg.dataset.renderStage = 'packed';
        const shifted = placement.map((ellipse) => ({
          x: ellipse.x + IX + canvasOption.MARGIN,
          y: ellipse.y + IY + canvasOption.MARGIN,
          rx: ellipse.rx,
          ry: ellipse.ry,
        }));

        bgctx.clearRect(0, 0, bg.width, bg.height);
        bgctx.fillStyle = 'white';
        bgctx.fillRect(0, 0, bg.width, bg.height);
        drawBackgroundGrid(
          bgctx,
          IX,
          IY,
          IW,
          IH,
          canvasOption.GRID_SIZE,
          0.4,
          'rgba(255,255,255,0.2)',
          canvasOption.MARGIN,
        );

        bgctx.strokeStyle = 'white';
        bgctx.lineWidth = 1;
        bgctx.setLineDash([1, 1]);
        for (let index = 0; index < shifted.length - 1; index += 1) {
          bgctx.beginPath();
          bgctx.moveTo(shifted[index].x, shifted[index].y);
          bgctx.lineTo(shifted[index + 1].x, shifted[index + 1].y);
          bgctx.stroke();
        }
        bgctx.setLineDash([]);
        shifted.forEach((ellipse, index) => {
          drawRadialGraph(bgctx, ellipse.x, ellipse.y, ellipse.rx, ellipse.ry, index);
        });
        drawAsciiParticles(bgctx, IX, IY, IW, IH, { avoid: shifted, seed: 13 });

        if (noise) {
          const pattern = bgctx.createPattern(noise, 'repeat');
          if (pattern) {
            bgctx.save();
            bgctx.globalAlpha = 0.7;
            bgctx.fillStyle = pattern;
            bgctx.fillRect(IX, IY, IW, IH);
            bgctx.restore();
          }
        }

        // Keep every asynchronous asset inside this generation and clean the
        // paper margins only after all inner layers are complete.
        bgctx.fillStyle = 'white';
        bgctx.fillRect(0, 0, bg.width, IY);
        bgctx.fillRect(0, IY + IH, bg.width, bg.height - (IY + IH));
        bgctx.fillRect(0, 0, IX, bg.height);
        bgctx.fillRect(IX + IW, 0, bg.width - (IX + IW), bg.height);

        const fonts = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE });
        if (canvasOption.showTitle) {
          drawHeader(
            bgctx,
            passageHeader,
            canvasOption.BG_SIDE_MARGIN + canvasOption.MARGIN,
            canvasOption.BG_TOP_MARGIN / 2,
            { font: fonts.headerFont(canvasOption.HEADER_SIZE), color: '#000' },
          );
        }
        if (canvasOption.showText) {
          drawWrappedColumns(bgctx, passageText, {
            x: canvasOption.BG_SIDE_MARGIN + canvasOption.MARGIN,
            y: canvasOption.BG_TOP_MARGIN + IH + 40,
            width: IW - 2 * canvasOption.MARGIN,
            height: canvasOption.BG_BOTTOM_MARGIN - 80,
            columns: 4,
            columnGap: 40,
            font: fonts.normalFont(),
            color: '#000',
            compassImage: compass,
          });
        }

        const paragraphNodes: WordNode[][] = [];
        const paragraphLinks: WordLink[][] = [];
        const collisionGroups: CollisionGroup[] = [];
        for (let paragraph = 0; paragraph < structure.length; paragraph += 1) {
          const parEllipse: EllipsePlacement = {
            x: placement[paragraph].x + canvasOption.MARGIN,
            y: placement[paragraph].y + canvasOption.MARGIN,
            rx: placement[paragraph].rx,
            ry: placement[paragraph].ry,
          };
          const { nodes, links, sim } = buildParagraphSim({
            ctx,
            sentences: structure[paragraph],
            paragraphIndex: paragraph,
            parEllipse,
            wordPx: canvasOption.WORD_SIZE,
            tokenizeAndBucket,
            random: seededRandom(
              hashString(`${paragraph}:${structure[paragraph].join(' ')}`),
            ),
          });
          paragraphNodes.push(nodes);
          paragraphLinks.push(links);
          collisionGroups.push({ ellipse: parEllipse, nodes });
          sims.push(sim);
        }
        fg.dataset.renderStage = 'simulations-built';
        const allNodes = collisionGroups.flatMap((group) => group.nodes);
        const collisionPoints: CollisionPoint[] = allNodes.map((node) => ({
          x: node.x,
          y: node.y,
          vx: 0,
          vy: 0,
          r: node.r,
        }));
        const globalCollisionSim = forceSimulation<CollisionPoint>(collisionPoints)
          .force(
            'collide',
            forceCollide<CollisionPoint>()
              .radius((point) => point.r + 1)
              .strength(1)
              .iterations(3),
          )
          .alpha(1)
          .alphaDecay(0.08)
          .stop();

        const drawFrame = () => {
          if (cancelled) return;
          ctx.clearRect(0, 0, fg.width, fg.height);
          for (const links of paragraphLinks) {
            for (const link of links) {
              const source = typeof link.source === 'number' ? null : link.source;
              const target = typeof link.target === 'number' ? null : link.target;
              if (!source || !target) continue;
              const dotted = link.kind === 'punct' || source.punctOnly || target.punctOnly;
              const weak = link.kind === 'order';
              ctx.strokeStyle = weak ? DEEPBLUEGREEN_HEX : 'rgba(255,255,255,0.50)';
              ctx.setLineDash(dotted ? [3, 3] : weak ? [1, 2] : []);
              ctx.lineWidth = weak ? 0.6 : 1;
              ctx.beginPath();
              ctx.moveTo(source.x ?? 0, source.y ?? 0);
              ctx.lineTo(target.x ?? 0, target.y ?? 0);
              ctx.stroke();
            }
          }
          ctx.setLineDash([]);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const nodes of paragraphNodes) {
            for (const node of nodes) {
              if (node.isFirstInSentence) ctx.font = fonts.firstWordFont();
              else if (node.bucket === 'ADJ') ctx.font = fonts.adjectiveFont();
              else if (node.bucket === 'NOUN') ctx.font = fonts.nounFont();
              else if (node.bucket === 'VERB') ctx.font = fonts.verbFont();
              else ctx.font = fonts.normalFont();
              ctx.fillStyle = 'white';
              ctx.fillText(
                node.punctOnly ? punctToASCIIStar(node.text) : node.text,
                node.x ?? 0,
                node.y ?? 0,
              );
            }
          }
        };

        const tickAll = (ticks: number) => {
          const bounds = {
            width: canvasOption.W,
            height: canvasOption.H,
            padding: canvasOption.MARGIN,
          };
          for (let tick = 0; tick < ticks; tick += 1) {
            sims.forEach((simulation) => simulation.tick());
            collisionGroups.forEach(clampGroup);
            collisionPoints.forEach((point, index) => {
              point.x = allNodes[index].x;
              point.y = allNodes[index].y;
              point.vx = 0;
              point.vy = 0;
            });
            globalCollisionSim.alpha(Math.max(0.18, globalCollisionSim.alpha()));
            globalCollisionSim.tick();
            allNodes.forEach((node, index) => {
              node.x = collisionPoints[index].x;
              node.y = collisionPoints[index].y;
              clampToCanvas(node, bounds);
            });
          }
        };

        const finishCollisions = () => {
          const bounds = {
            width: canvasOption.W,
            height: canvasOption.H,
            padding: canvasOption.MARGIN,
          };
          for (let tick = 0; tick < 16; tick += 1) {
            collisionPoints.forEach((point, index) => {
              point.x = allNodes[index].x;
              point.y = allNodes[index].y;
              point.vx = 0;
              point.vy = 0;
            });
            globalCollisionSim.alpha(Math.max(0.12, globalCollisionSim.alpha()));
            globalCollisionSim.tick();
            allNodes.forEach((node, index) => {
              node.x = collisionPoints[index].x;
              node.y = collisionPoints[index].y;
              clampToCanvas(node, bounds);
            });
          }
          resolveGlobalWordCollisions(
            collisionGroups,
            bounds,
            64,
          );
          const overlapCount = countGlobalWordOverlaps(collisionGroups);
          fg.dataset.wordOverlaps = String(overlapCount);
          fg.dataset.renderStage = 'settled';
          if (overlapCount > 0) {
            ctx.clearRect(0, 0, fg.width, fg.height);
            ctx.fillStyle = '#f0b4b4';
            ctx.font = '24px Newsreader, serif';
            ctx.fillText('This passage is too dense to place without overlap.', 40, 80);
            onReadyChange?.(false);
            return false;
          }
          return true;
        };

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reducedMotion || document.hidden) {
          tickAll(32);
          if (finishCollisions()) {
            drawFrame();
            onReadyChange?.(true);
          }
          return;
        }

        let frame = 0;
        const advance = () => {
          if (cancelled) return;
          tickAll(4);
          frame += 1;
          if (frame < 8) {
            drawFrame();
            animationFrame = window.requestAnimationFrame(advance);
          } else {
            if (finishCollisions()) {
              drawFrame();
              onReadyChange?.(true);
            }
          }
        };
        animationFrame = window.requestAnimationFrame(advance);
      } catch {
        if (cancelled) return;
        bgctx.clearRect(0, 0, bg.width, bg.height);
        ctx.clearRect(0, 0, fg.width, fg.height);
        ctx.fillStyle = '#f0b4b4';
        ctx.font = '24px Newsreader, serif';
        ctx.fillText('The canvas could not render. Try a shorter passage.', 40, 80);
        onReadyChange?.(false);
      }
    };

    void render();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      sims.forEach((simulation) => simulation.stop());
      onReadyChange?.(false);
    };
  }, [
    BG_WIDTH, BG_HEIGHT,
    INNER_X, INNER_Y,
    canvasOption, canvasRef, bgRef,
    passageHeader, passageText,
    sizes, structure,
    onReadyChange,
  ]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
    >
      <div
        ref={stageRef}
        className="relative cursor-crosshair"
        style={{ width: BG_WIDTH * scale, height: BG_HEIGHT * scale }}
      >
        <div
          className="absolute inset-0"
          style={{
            width: BG_WIDTH,
            height: BG_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div
            ref={zoomRef}
            className="absolute inset-0 transition-transform duration-300 ease-out"
          >
            <canvas
              ref={bgRef}
              className="absolute inset-0 z-[1] block"
              width={BG_WIDTH}
              height={BG_HEIGHT}
            />
            <canvas
              ref={canvasRef}
              className="absolute z-[6] block"
              width={canvasOption.W}
              height={canvasOption.H}
              style={{
                top: canvasOption.BG_TOP_MARGIN,
                left: canvasOption.BG_SIDE_MARGIN,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
