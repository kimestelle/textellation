// DrawCanvas.tsx
'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Simulation } from 'd3-force';

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
import { CanvasOption } from './settings/canvasOptions';

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
  canvasOption: CanvasOption;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bgRef: React.RefObject<HTMLCanvasElement | null>;
};

export default function DrawCanvas({
  passageText,
  passageHeader,
  canvasOption,
  canvasRef,
  bgRef,
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

    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.visualViewport?.addEventListener('resize', compute);

    return () => {
      ro.disconnect();
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
      const stageRect   = stageRef.current!.getBoundingClientRect();
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
      const wc = sentences.reduce((a, s) => {
        const tokens = tokenizeAndBucket(s).tokens;
        const nonPunct = tokens.filter((t) => !/^[,.;:!?—–\-()"'`]+$/.test(t)).length;
        return a + nonPunct;
      }, 0);

      return ellipseSizeFromWords(
        wc,
        canvasOption.W - 2 * canvasOption.MARGIN,
        { minS: 220, maxS: 700, mix: 0.1 }
      );
    });
  }, [structure, canvasOption]);

  useEffect(() => {
    const fg = canvasRef.current;
    if (!fg) return;
    const ctx = fg.getContext('2d');
    if (!ctx) return;

    const bg = bgRef.current;
    if (!bg) return;
    const bgctx = bg.getContext('2d');
    if (!bgctx) return;

    if (bg.width !== BG_WIDTH) bg.width = BG_WIDTH;
    if (bg.height !== BG_HEIGHT) bg.height = BG_HEIGHT;

    const IX = INNER_X;
    const IY = INNER_Y;
    const IW = canvasOption.W;
    const IH = canvasOption.H;

    const packed = tightPack(
      canvasOption.W - 2 * canvasOption.MARGIN,
      canvasOption.H - 2 * canvasOption.MARGIN,
      canvasOption.WORD_SIZE,
      sizes,
      { gridStep: 20, areaSlack: 0.78, orderBias: 0.25, edgeBias: 0.08 },
      0.58,
      18,
      1.0015
    );

    if (packed === 'FAIL') {
      bgctx.clearRect(0, 0, bg.width, bg.height);
      bgctx.fillStyle = 'white';
      bgctx.fillRect(0, 0, bg.width, bg.height);

      ctx.clearRect(0, 0, fg.width, fg.height);
      ctx.fillStyle = '#b00020';
      ctx.font = `${canvasOption.WORD_SIZE * 2}px Newsreader`;
      ctx.fillText(
        'Content cannot fit, please enter a shorter passage.',
        canvasOption.BG_SIDE_MARGIN * 2,
        canvasOption.BG_TOP_MARGIN + 100
      );
      return;
    }

    const { placement } = packed;

    // shift placement into bg space (inner panel + margins) for bg drawing + avoid-field
    const shifted = placement.map((e) => ({
      x: e.x + IX + canvasOption.MARGIN,
      y: e.y + IY + canvasOption.MARGIN,
      rx: e.rx,
      ry: e.ry,
    }));

    // --- background ---
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
      canvasOption.MARGIN
    );

    // noise overlay
    const noise = new Image();
    noise.src = '/noisy.png';
    noise.onload = () => {
      const pat = bgctx.createPattern(noise, 'repeat');
      if (!pat) return;
      bgctx.save();
      bgctx.globalAlpha = 0.7;
      bgctx.fillStyle = pat;
      bgctx.fillRect(IX, IY, IW, IH);
      bgctx.restore();
    };

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

    for (let i = 0; i < shifted.length; i++) {
      const e = shifted[i];
      drawRadialGraph(bgctx, e.x, e.y, e.rx, e.ry, i);
    }

    drawAsciiParticles(bgctx, IX, IY, IW, IH, { avoid: shifted });

    // clean outside inner canvas
    bgctx.fillRect(0, 0, bg.width, IY);
    bgctx.fillRect(0, IY + IH, bg.width, bg.height - (IY + IH));
    bgctx.fillRect(0, 0, IX, bg.height);
    bgctx.fillRect(IX + IW, 0, bg.width - (IX + IW), bg.height);

    if (canvasOption.showTitle) {
      const fonts = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE });
      bgctx.save();
      drawHeader(
        bgctx,
        passageHeader,
        canvasOption.BG_SIDE_MARGIN + canvasOption.MARGIN,
        canvasOption.BG_TOP_MARGIN / 2,
        { font: fonts.headerFont(canvasOption.HEADER_SIZE), color: '#000' }
      );
      bgctx.restore();
    }

    if (canvasOption.showText) {
      const fonts = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE });
      drawWrappedColumns(bgctx, passageText, {
        x: canvasOption.BG_SIDE_MARGIN + canvasOption.MARGIN,
        y: canvasOption.BG_TOP_MARGIN + IH + 40,
        width: IW - 2 * canvasOption.MARGIN,
        height: canvasOption.BG_BOTTOM_MARGIN - 80,
        columns: 4,
        columnGap: 40,
        font: fonts.normalFont(),
        color: '#000',
      });
    }

    // foreground text simulations
    const fonts = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE });

    const paragraphNodes: WordNode[][] = [];
    const paragraphLinks: WordLink[][] = [];
    const sims: Array<Simulation<WordNode, undefined>> = [];

    // draw all paragraphs on fg
    const drawFrame = () => {
      ctx.clearRect(0, 0, fg.width, fg.height);

      // links
      for (const links of paragraphLinks) {
        for (const L of links) {
          const s = (typeof L.source === 'number' ? null : L.source) as WordNode | null;
          const t = (typeof L.target === 'number' ? null : L.target) as WordNode | null;
          if (!s || !t) continue;

          const dotted = L.kind === 'punct' || s.punctOnly || t.punctOnly;
          const weak = L.kind === 'order';
          ctx.strokeStyle = (weak ? DEEPBLUEGREEN_HEX : 'rgba(255,255,255,0.50)');
          ctx.setLineDash(dotted ? [3, 3] : (weak ? [1, 2] : []));
          ctx.lineWidth = (weak ? 0.6 : 1);

          ctx.beginPath();
          ctx.moveTo(s.x ?? 0, s.y ?? 0);
          ctx.lineTo(t.x ?? 0, t.y ?? 0);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // words
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const nodes of paragraphNodes) {
        for (const n of nodes) {
          if (
            n.isFirstInSentence
          ) ctx.font = fonts.firstWordFont();
          else if (n.bucket === 'ADJ') ctx.font = fonts.adjectiveFont();
          else if (n.bucket === 'NOUN') ctx.font = fonts.nounFont();
          else if (n.bucket === 'VERB') ctx.font = fonts.verbFont();
          else ctx.font = fonts.normalFont();

          ctx.fillStyle = 'white';
          ctx.fillText(n.punctOnly ? punctToASCIIStar(n.text) : n.text, n.x ?? 0, n.y ?? 0);
        }
      }
    };

    // build sims per paragraph
    for (let p = 0; p < structure.length; p++) {
      const parEllipse: EllipsePlacement = {
        x: placement[p].x + canvasOption.MARGIN,
        y: placement[p].y + canvasOption.MARGIN,
        rx: placement[p].rx,
        ry: placement[p].ry,
      };

      const { nodes, links, sim } = buildParagraphSim({
        ctx,
        sentences: structure[p],
        paragraphIndex: p,
        parEllipse,
        wordPx: canvasOption.WORD_SIZE,
        tokenizeAndBucket,
        onTick: () => {
          // keep inside ellipse & small boundary push
          for (const n of nodes) {
            const nx = n.x ?? parEllipse.x;
            const ny = n.y ?? parEllipse.y;
            const cl = clampEllipse(nx, ny, parEllipse.x, parEllipse.y, parEllipse.rx, parEllipse.ry, n.r);
            n.x = cl.x;
            n.y = cl.y;
          }
          drawFrame();
        },
      });

      paragraphNodes.push(nodes);
      paragraphLinks.push(links);
      sims.push(sim);
    }

    drawFrame();

    return () => {
      sims.forEach((s) => s.stop());
    };
  }, [
    BG_WIDTH, BG_HEIGHT,
    INNER_X, INNER_Y,
    canvasOption, canvasRef, bgRef,
    passageHeader, passageText,
    sizes, structure,
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
