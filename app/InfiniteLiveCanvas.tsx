'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Simulation } from 'd3-force';
import type { InfiniteCanvasOption } from './settings/canvasOptions';
import {
  ellipseSizeFromWords,
  growingTightPack,
  type Ellipse,
} from './helpers/paragraphHelpers';
import { tokenizeAndBucket } from './helpers/posHelpers';
import {
  buildParagraphSim,
  clampEllipse,
  makeFonts,
  type WordLink,
  type WordNode,
} from './helpers/sentenceHelpers';
import {
  asciiStars,
  BLUE_HEX,
  DEEPBLUEGREEN_HEX,
  punctToASCIIStar,
} from './helpers/drawHelpers';
import { hashString, seededRandom } from './helpers/randomHelpers';

type ViewTransform = { x: number; y: number; scale: number };
type ContentBounds = { x: number; y: number; width: number; height: number };

type RegionGeometry = {
  nodes: WordNode[];
  links: WordLink[];
};

type LiveRegion = RegionGeometry & {
  key: string;
  ellipse: Ellipse;
};

type LiveModel = {
  bounds: ContentBounds;
  regions: LiveRegion[];
};

type Props = {
  passageText: string;
  passageHeader: string;
  canvasOption: InfiniteCanvasOption;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onReadyChange?: (ready: boolean) => void;
};

type PointerPosition = { x: number; y: number };
type PinchGesture = {
  distance: number;
  midpoint: PointerPosition;
  view: ViewTransform;
};

const LIVE_SEED = hashString('textellation:infinite-live:001');
const REGION_PADDING = 72;
const REGION_HALO = 1.7;
const MAX_PARTICLE_TILES = 120;

function splitSentences(paragraph: string) {
  return (paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [paragraph])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function paddedBounds(ellipses: Ellipse[]): ContentBounds {
  const minX = Math.min(...ellipses.map((ellipse) => ellipse.x - ellipse.rx * REGION_HALO));
  const minY = Math.min(...ellipses.map((ellipse) => ellipse.y - ellipse.ry * REGION_HALO));
  const maxX = Math.max(...ellipses.map((ellipse) => ellipse.x + ellipse.rx * REGION_HALO));
  const maxY = Math.max(...ellipses.map((ellipse) => ellipse.y + ellipse.ry * REGION_HALO));
  return {
    x: minX - REGION_PADDING,
    y: minY - REGION_PADDING,
    width: maxX - minX + REGION_PADDING * 2,
    height: maxY - minY + REGION_PADDING * 2,
  };
}

function intersects(ellipse: Ellipse, bounds: ContentBounds) {
  return !(
    ellipse.x + ellipse.rx * REGION_HALO < bounds.x ||
    ellipse.x - ellipse.rx * REGION_HALO > bounds.x + bounds.width ||
    ellipse.y + ellipse.ry * REGION_HALO < bounds.y ||
    ellipse.y - ellipse.ry * REGION_HALO > bounds.y + bounds.height
  );
}

function drawInfiniteBackground(
  context: CanvasRenderingContext2D,
  visible: ContentBounds,
  focus: ContentBounds,
  gridSize: number,
  scale: number,
) {
  const centerX = focus.x + focus.width / 2;
  const centerY = focus.y + focus.height / 2;
  const reference = Math.max(960, focus.width, focus.height);
  const gradient = context.createRadialGradient(
    centerX,
    centerY,
    reference * 0.35,
    centerX,
    centerY,
    reference * 0.65,
  );
  gradient.addColorStop(0, BLUE_HEX);
  gradient.addColorStop(1, DEEPBLUEGREEN_HEX);
  context.fillStyle = DEEPBLUEGREEN_HEX;
  context.fillRect(visible.x, visible.y, visible.width, visible.height);
  context.fillStyle = gradient;
  context.fillRect(visible.x, visible.y, visible.width, visible.height);

  let adaptiveGrid = gridSize;
  while (adaptiveGrid * scale < 7) adaptiveGrid *= 2;
  context.save();
  context.strokeStyle = 'rgba(255,255,255,0.20)';
  context.lineWidth = 0.4;
  context.setLineDash([1, 1]);
  const left = Math.floor(visible.x / adaptiveGrid) * adaptiveGrid;
  const right = Math.ceil((visible.x + visible.width) / adaptiveGrid) * adaptiveGrid;
  const top = Math.floor(visible.y / adaptiveGrid) * adaptiveGrid;
  const bottom = Math.ceil((visible.y + visible.height) / adaptiveGrid) * adaptiveGrid;
  for (let x = left; x <= right; x += adaptiveGrid) {
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }
  for (let y = top; y <= bottom; y += adaptiveGrid) {
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  }
  context.restore();
}

function drawLiveRadialGraph(
  context: CanvasRenderingContext2D,
  ellipse: Ellipse,
  index: number,
) {
  context.save();
  context.beginPath();
  context.ellipse(ellipse.x, ellipse.y, ellipse.rx, ellipse.ry, 0, 0, Math.PI * 2);
  context.clip();
  context.strokeStyle = 'rgba(255,255,255,0.72)';
  context.lineWidth = 1.2;
  context.setLineDash([1, 1]);
  const radius = Math.max(ellipse.rx, ellipse.ry);
  for (let spoke = 0; spoke < 16; spoke += 1) {
    const angle = (spoke / 16) * Math.PI * 2;
    context.beginPath();
    context.moveTo(ellipse.x, ellipse.y);
    context.lineTo(
      ellipse.x + radius * Math.cos(angle),
      ellipse.y + radius * Math.sin(angle),
    );
    context.stroke();
  }
  context.restore();

  context.save();
  const glow = context.createRadialGradient(
    ellipse.x,
    ellipse.y,
    0,
    ellipse.x,
    ellipse.y,
    ellipse.rx * REGION_HALO,
  );
  glow.addColorStop(0, 'rgba(255,255,255,0.12)');
  glow.addColorStop(1, 'rgba(39,39,87,0)');
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(
    ellipse.x,
    ellipse.y,
    ellipse.rx * REGION_HALO,
    ellipse.ry * REGION_HALO,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.font = '400 100px Newsreader, Georgia, serif';
  context.fillStyle = 'rgba(255,255,255,0.18)';
  context.textAlign = index % 2 ? 'right' : 'left';
  context.textBaseline = index % 3 ? 'top' : 'bottom';
  context.fillText(
    `${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][index % 9]}.`,
    ellipse.x + (index % 2 ? ellipse.rx ** 0.92 : -(ellipse.rx ** 0.92)),
    ellipse.y + (index % 3 ? -(ellipse.ry ** 0.92) : ellipse.ry ** 0.92),
  );
  context.restore();
}

function drawVisibleParticles(
  context: CanvasRenderingContext2D,
  visible: ContentBounds,
  regions: LiveRegion[],
  scale: number,
) {
  if (scale < 0.1) return;
  const tileSize = 512;
  const startX = Math.floor(visible.x / tileSize);
  const endX = Math.ceil((visible.x + visible.width) / tileSize);
  const startY = Math.floor(visible.y / tileSize);
  const endY = Math.ceil((visible.y + visible.height) / tileSize);
  const tileCount = (endX - startX) * (endY - startY);
  if (tileCount > MAX_PARTICLE_TILES) return;

  context.save();
  context.font = '12px "Star Glyphs", monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      const random = seededRandom(
        LIVE_SEED ^ Math.imul(tileX, 73_856_093) ^ Math.imul(tileY, 19_349_663),
      );
      for (let particle = 0; particle < 48; particle += 1) {
        const x = tileX * tileSize + random() * tileSize;
        const y = tileY * tileSize + random() * tileSize;
        const insideRegion = regions.some((region) => {
          const dx = (x - region.ellipse.x) / Math.max(1, region.ellipse.rx);
          const dy = (y - region.ellipse.y) / Math.max(1, region.ellipse.ry);
          return dx * dx + dy * dy < 1;
        });
        if (insideRegion || random() < 0.48) continue;
        context.globalAlpha = 0.28 + random() * 0.34;
        context.fillStyle = 'white';
        context.fillText(
          asciiStars[Math.floor(random() * asciiStars.length)],
          x,
          y,
        );
      }
    }
  }
  context.restore();
}

function drawRegion(
  context: CanvasRenderingContext2D,
  region: LiveRegion,
  wordSize: number,
) {
  const fonts = makeFonts({ family: 'Newsreader', wordPx: wordSize });
  context.save();
  context.translate(region.ellipse.x, region.ellipse.y);
  for (const link of region.links) {
    const source = typeof link.source === 'number' ? null : link.source;
    const target = typeof link.target === 'number' ? null : link.target;
    if (!source || !target) continue;
    const dotted = link.kind === 'punct' || source.punctOnly || target.punctOnly;
    const weak = link.kind === 'order';
    context.strokeStyle = weak ? DEEPBLUEGREEN_HEX : 'rgba(255,255,255,0.52)';
    context.setLineDash(dotted ? [3, 3] : weak ? [1, 2] : []);
    context.lineWidth = weak ? 0.6 : 1;
    context.beginPath();
    context.moveTo(source.x ?? 0, source.y ?? 0);
    context.lineTo(target.x ?? 0, target.y ?? 0);
    context.stroke();
  }
  context.setLineDash([]);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const node of region.nodes) {
    if (node.isFirstInSentence) context.font = fonts.firstWordFont();
    else if (node.bucket === 'ADJ') context.font = fonts.adjectiveFont();
    else if (node.bucket === 'NOUN') context.font = fonts.nounFont();
    else if (node.bucket === 'VERB') context.font = fonts.verbFont();
    else context.font = fonts.normalFont();
    context.fillStyle = 'white';
    context.fillText(
      node.punctOnly ? punctToASCIIStar(node.text) : node.text,
      node.x ?? 0,
      node.y ?? 0,
    );
  }
  context.restore();
}

export default function InfiniteLiveCanvas({
  passageText,
  passageHeader,
  canvasOption,
  canvasRef,
  onReadyChange,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const geometryCacheRef = useRef(new Map<string, RegionGeometry>());
  const viewportRef = useRef({ width: 0, height: 0 });
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 0.7 });
  const viewFrameRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pointersRef = useRef(new Map<number, PointerPosition>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const hasCenteredRef = useRef(false);
  const noiseRef = useRef<HTMLImageElement | null>(null);
  const [model, setModel] = useState<LiveModel | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(viewRef.current);
  const [isPanning, setIsPanning] = useState(false);
  const [isBuilding, setIsBuilding] = useState(true);
  const [error, setError] = useState('');
  const [textureVersion, setTextureVersion] = useState(0);

  const paragraphs = useMemo(
    () =>
      passageText
        .split(/\n+/)
        .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    [passageText],
  );

  const clampScale = useCallback(
    (scale: number) =>
      Math.min(canvasOption.MAX_ZOOM, Math.max(canvasOption.MIN_ZOOM, scale)),
    [canvasOption.MAX_ZOOM, canvasOption.MIN_ZOOM],
  );

  const scheduleView = useCallback(
    (next: ViewTransform | ((current: ViewTransform) => ViewTransform)) => {
      const resolved = typeof next === 'function' ? next(viewRef.current) : next;
      viewRef.current = {
        x: Number.isFinite(resolved.x) ? resolved.x : 0,
        y: Number.isFinite(resolved.y) ? resolved.y : 0,
        scale: clampScale(resolved.scale),
      };
      if (viewFrameRef.current) return;
      viewFrameRef.current = window.requestAnimationFrame(() => {
        viewFrameRef.current = 0;
        setView(viewRef.current);
      });
    },
    [clampScale],
  );

  const fitAll = useCallback(() => {
    if (!model || !viewport.width || !viewport.height) return;
    const air = Math.min(viewport.width, viewport.height) * 0.12;
    const scale = clampScale(
      Math.min(
        (viewport.width - air * 2) / Math.max(1, model.bounds.width),
        (viewport.height - air * 2) / Math.max(1, model.bounds.height),
        1,
      ),
    );
    scheduleView({
      scale,
      x: viewport.width / 2 - (model.bounds.x + model.bounds.width / 2) * scale,
      y: viewport.height / 2 - (model.bounds.y + model.bounds.height / 2) * scale,
    });
    hasCenteredRef.current = true;
  }, [clampScale, model, scheduleView, viewport]);

  const focusFirst = useCallback(() => {
    const first = model?.regions[0]?.ellipse;
    if (!first || !viewport.width || !viewport.height) return;
    const air = Math.min(viewport.width, viewport.height) * 0.14;
    const fitted = Math.min(
      (viewport.width - air * 2) / Math.max(1, first.rx * REGION_HALO * 2),
      (viewport.height - air * 2) / Math.max(1, first.ry * REGION_HALO * 2),
      0.8,
    );
    const scale = clampScale(Math.max(0.32, fitted));
    scheduleView({
      scale,
      x: viewport.width / 2 - first.x * scale,
      y: viewport.height / 2 - first.y * scale,
    });
    hasCenteredRef.current = true;
  }, [clampScale, model, scheduleView, viewport]);

  const zoomAt = useCallback(
    (factor: number, focusX: number, focusY: number) => {
      scheduleView((current) => {
        const scale = clampScale(current.scale * factor);
        const worldX = (focusX - current.x) / current.scale;
        const worldY = (focusY - current.y) / current.scale;
        return {
          scale,
          x: focusX - worldX * scale,
          y: focusY - worldY * scale,
        };
      });
    },
    [clampScale, scheduleView],
  );

  useEffect(() => {
    return () => window.cancelAnimationFrame(viewFrameRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    const ready = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('texture unavailable'));
          image.src = '/noisy.png';
          if (image.complete) {
            if (image.naturalWidth > 0) resolve();
            else reject(new Error('texture unavailable'));
          }
        });
        if (typeof image.decode === 'function') {
          try {
            await image.decode();
          } catch {
            if (!image.naturalWidth) throw new Error('texture unavailable');
          }
        }
        if (cancelled) return;
        noiseRef.current = image;
        setTextureVersion((version) => version + 1);
      } catch {
        // Texture is optional; the deterministic field still renders.
      }
    };
    void ready();
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const rect = wrapper.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const previous = viewportRef.current;
      const next = { width: rect.width, height: rect.height };
      viewportRef.current = next;
      setViewport(next);
      if (!previous.width || !previous.height || !hasCenteredRef.current) return;
      scheduleView((current) => {
        const centerX = (previous.width / 2 - current.x) / current.scale;
        const centerY = (previous.height / 2 - current.y) / current.scale;
        return {
          ...current,
          x: next.width / 2 - centerX * current.scale,
          y: next.height / 2 - centerY * current.scale,
        };
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update);
    observer?.observe(wrapper);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [scheduleView]);

  useEffect(() => {
    let cancelled = false;
    const simulations: Array<Simulation<WordNode, undefined>> = [];
    const workingCache = new Map(geometryCacheRef.current);
    hasCenteredRef.current = false;
    setIsBuilding(true);
    setError('');
    onReadyChange?.(false);

    const build = async () => {
      try {
        if (document.fonts) {
          await Promise.all([
            document.fonts.load(`${canvasOption.WORD_SIZE}px Newsreader`),
            document.fonts.ready,
          ]);
        }
        if (cancelled) return;
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (cancelled) return;
        const measurement = document.createElement('canvas');
        const context = measurement.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        context.font = `${canvasOption.WORD_SIZE}px Newsreader`;

        const structures = paragraphs.map(splitSentences);
        const sizes = structures.map((sentences) => {
          const nodes = sentences.reduce(
            (total, sentence) => total + tokenizeAndBucket(sentence).tokens.length,
            0,
          );
          return ellipseSizeFromWords(
            nodes,
            canvasOption.W - canvasOption.MARGIN * 2,
            { minS: 220, maxS: 700, mix: 0.1 },
          );
        });
        if (!sizes.length) throw new Error('Add some text to create a live field.');
        const packed = growingTightPack(
          canvasOption.W - canvasOption.MARGIN * 2,
          canvasOption.H - canvasOption.MARGIN * 2,
          canvasOption.WORD_SIZE,
          sizes,
        );

        const occurrences = new Map<string, number>();
        const activeKeys = new Set<string>();
        const regions: LiveRegion[] = [];
        for (let index = 0; index < structures.length; index += 1) {
          const source = paragraphs[index];
          const occurrence = occurrences.get(source) ?? 0;
          occurrences.set(source, occurrence + 1);
          const ellipse = packed.placement[index];
          const key = [
            source,
            occurrence,
            canvasOption.WORD_SIZE,
            ellipse.rx.toFixed(3),
            ellipse.ry.toFixed(3),
          ].join('\u001f');
          activeKeys.add(key);
          let geometry = workingCache.get(key);
          if (!geometry) {
            const localEllipse = { x: 0, y: 0, rx: ellipse.rx, ry: ellipse.ry };
            const built = buildParagraphSim({
              ctx: context,
              sentences: structures[index],
              paragraphIndex: 0,
              parEllipse: localEllipse,
              wordPx: canvasOption.WORD_SIZE,
              tokenizeAndBucket,
              random: seededRandom(LIVE_SEED ^ hashString(key)),
            });
            simulations.push(built.sim);
            for (let tick = 0; tick < 40; tick += 1) {
              built.sim.tick();
              for (const node of built.nodes) {
                const clamped = clampEllipse(
                  node.x ?? 0,
                  node.y ?? 0,
                  0,
                  0,
                  localEllipse.rx,
                  localEllipse.ry,
                  node.r,
                );
                node.x = clamped.x;
                node.y = clamped.y;
              }
            }
            built.sim.stop();
            geometry = { nodes: built.nodes, links: built.links };
            workingCache.set(key, geometry);
            if (index > 0 && index % 2 === 0) {
              await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
              if (cancelled) return;
            }
          }
          regions.push({
            key,
            nodes: geometry.nodes,
            links: geometry.links,
            ellipse: {
              x: ellipse.x + canvasOption.MARGIN,
              y: ellipse.y + canvasOption.MARGIN,
              rx: ellipse.rx,
              ry: ellipse.ry,
            },
          });
        }
        if (cancelled) return;
        geometryCacheRef.current = new Map(
          [...workingCache].filter(([key]) => activeKeys.has(key)),
        );
        setModel({ bounds: paddedBounds(regions.map((region) => region.ellipse)), regions });
        setIsBuilding(false);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'The live field could not render.');
        setIsBuilding(false);
      }
    };

    void build();
    return () => {
      cancelled = true;
      simulations.forEach((simulation) => simulation.stop());
      onReadyChange?.(false);
    };
  }, [canvasOption, onReadyChange, paragraphs]);

  useEffect(() => {
    if (model && !hasCenteredRef.current) focusFirst();
  }, [focusFirst, model]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const focusX = event.clientX - rect.left;
      const focusY = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoomAt(factor, focusX, focusY);
    };
    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', handleWheel);
  }, [zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !viewport.width || !viewport.height) {
      onReadyChange?.(false);
      return;
    }
    const maxDimension = 4096;
    const maxPixels = 16_000_000;
    const pixelRatio = Math.max(
      0.25,
      Math.min(
        window.devicePixelRatio || 1,
        2,
        maxDimension / viewport.width,
        maxDimension / viewport.height,
        Math.sqrt(maxPixels / (viewport.width * viewport.height)),
      ),
    );
    const width = Math.max(1, Math.ceil(viewport.width * pixelRatio));
    const height = Math.max(1, Math.ceil(viewport.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);

    const visible = {
      x: -view.x / view.scale,
      y: -view.y / view.scale,
      width: viewport.width / view.scale,
      height: viewport.height / view.scale,
    };
    const focus = model?.bounds ?? {
      x: 0,
      y: 0,
      width: canvasOption.W,
      height: canvasOption.H,
    };
    context.setTransform(
      pixelRatio * view.scale,
      0,
      0,
      pixelRatio * view.scale,
      pixelRatio * view.x,
      pixelRatio * view.y,
    );
    drawInfiniteBackground(
      context,
      visible,
      focus,
      canvasOption.GRID_SIZE,
      view.scale,
    );

    if (model) {
      context.save();
      context.strokeStyle = 'rgba(255,255,255,0.72)';
      context.lineWidth = 1;
      context.setLineDash([2, 3]);
      for (let index = 0; index < model.regions.length - 1; index += 1) {
        const first = model.regions[index].ellipse;
        const second = model.regions[index + 1].ellipse;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
      context.restore();
      const visibleRegions = model.regions.filter((region) => intersects(region.ellipse, visible));
      visibleRegions.forEach((region) => {
        drawLiveRadialGraph(context, region.ellipse, model.regions.indexOf(region));
      });
      drawVisibleParticles(context, visible, visibleRegions, view.scale);
      visibleRegions.forEach((region) => {
        drawRegion(context, region, canvasOption.WORD_SIZE);
      });

      context.save();
      context.fillStyle = 'rgba(255,255,255,0.88)';
      context.font = 'italic 500 34px Newsreader, Georgia, serif';
      context.textAlign = 'left';
      context.textBaseline = 'bottom';
      context.fillText(passageHeader, model.bounds.x, model.bounds.y - 12);
      context.restore();
    }

    const texture = noiseRef.current;
    if (texture) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const pattern = context.createPattern(texture, 'repeat');
      if (pattern) {
        context.globalAlpha = 0.22;
        context.fillStyle = pattern;
        context.fillRect(0, 0, viewport.width, viewport.height);
        context.globalAlpha = 1;
      }
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    onReadyChange?.(!isBuilding && Boolean(model) && !error);
  }, [
    canvasOption,
    canvasRef,
    model,
    error,
    isBuilding,
    onReadyChange,
    passageHeader,
    textureVersion,
    view,
    viewport,
  ]);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const pointers = [...pointersRef.current.entries()];
    if (pointers.length >= 2) {
      const first = pointers[0][1];
      const second = pointers[1][1];
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        midpoint: {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        },
        view: { ...viewRef.current },
      };
      dragRef.current = null;
    } else {
      dragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX - rect.left,
        clientY: event.clientY - rect.top,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
      };
    }
    setIsPanning(true);
  };

  const continuePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    const pointers = [...pointersRef.current.values()];
    const pinch = pinchRef.current;
    if (pointers.length >= 2 && pinch) {
      const first = pointers[0];
      const second = pointers[1];
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const scale = clampScale(pinch.view.scale * (distance / pinch.distance));
      const worldX = (pinch.midpoint.x - pinch.view.x) / pinch.view.scale;
      const worldY = (pinch.midpoint.y - pinch.view.y) / pinch.view.scale;
      scheduleView({
        scale,
        x: midpoint.x - worldX * scale,
        y: midpoint.y - worldY * scale,
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    scheduleView((current) => ({
      ...current,
      x: drag.originX + (event.clientX - rect.left) - drag.clientX,
      y: drag.originY + (event.clientY - rect.top) - drag.clientY,
    }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pinchRef.current = null;
    const remaining = [...pointersRef.current.entries()];
    if (remaining.length >= 2) {
      const first = remaining[0][1];
      const second = remaining[1][1];
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        midpoint: {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        },
        view: { ...viewRef.current },
      };
      dragRef.current = null;
    } else if (remaining.length === 1) {
      const [pointerId, pointer] = remaining[0];
      dragRef.current = {
        pointerId,
        clientX: pointer.x,
        clientY: pointer.y,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
      };
    } else {
      dragRef.current = null;
      setIsPanning(false);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? canvasOption.GRID_SIZE * 8 : canvasOption.GRID_SIZE * 3;
    if (event.key === 'ArrowLeft') scheduleView((current) => ({ ...current, x: current.x + step }));
    else if (event.key === 'ArrowRight') scheduleView((current) => ({ ...current, x: current.x - step }));
    else if (event.key === 'ArrowUp') scheduleView((current) => ({ ...current, y: current.y + step }));
    else if (event.key === 'ArrowDown') scheduleView((current) => ({ ...current, y: current.y - step }));
    else if (event.key === '+' || event.key === '=') {
      zoomAt(1.22, viewport.width / 2, viewport.height / 2);
    } else if (event.key === '-' || event.key === '_') {
      zoomAt(0.82, viewport.width / 2, viewport.height / 2);
    } else if (event.key === '0' || event.key === 'Home') fitAll();
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#121c2d] outline-none"
      data-canvas-kind="infinite"
      data-panning={isPanning || undefined}
      role="region"
      tabIndex={0}
      aria-label="Infinite live textellation canvas. Drag to pan, pinch or scroll to zoom, or double-click for overview."
      onDoubleClick={fitAll}
      onKeyDown={handleKeyDown}
      onPointerDown={startPan}
      onPointerMove={continuePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={endPan}
      style={{ touchAction: 'none', cursor: isPanning ? 'grabbing' : 'grab' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block w-full h-full"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 text-[11px] text-white/55">
        ∞ live field · drag / pinch / scroll · {Math.round(view.scale * 100)}%
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex gap-1">
        <button
          type="button"
          className="h-7 min-w-7 border-white/25 bg-black/25 px-2 text-xs text-white/75"
          aria-label="Zoom out"
          onPointerDown={(event) => {
            event.stopPropagation();
            zoomAt(0.82, viewport.width / 2, viewport.height / 2);
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail === 0) zoomAt(0.82, viewport.width / 2, viewport.height / 2);
          }}
        >
          −
        </button>
        <button
          type="button"
          className="h-7 min-w-7 border-white/25 bg-black/25 px-2 text-xs text-white/75"
          aria-label="Show all regions"
          onPointerDown={(event) => {
            event.stopPropagation();
            fitAll();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail === 0) fitAll();
          }}
        >
          all
        </button>
        <button
          type="button"
          className="h-7 min-w-7 border-white/25 bg-black/25 px-2 text-xs text-white/75"
          aria-label="Zoom in"
          onPointerDown={(event) => {
            event.stopPropagation();
            zoomAt(1.22, viewport.width / 2, viewport.height / 2);
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.detail === 0) zoomAt(1.22, viewport.width / 2, viewport.height / 2);
          }}
        >
          +
        </button>
      </div>
      {(isBuilding || error) && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#121c2d]/70 px-8 text-center text-sm text-white/75"
          role={error ? 'alert' : 'status'}
        >
          {error || 'settling the live field…'}
        </div>
      )}
    </div>
  );
}
