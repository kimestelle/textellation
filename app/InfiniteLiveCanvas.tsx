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
  BLUE_HEX,
  DEEPBLUEGREEN_HEX,
  drawAsciiParticles,
  drawRadialGraph,
  punctToASCIIStar,
} from './helpers/drawHelpers';
import { hashString, seededRandom } from './helpers/randomHelpers';
import {
  hitTestInspection,
  type CanvasInspection,
  type InspectableRegion,
} from './helpers/inspectionHelpers';
import InspectionCornerDetails from './components/InspectionCornerDetails';

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
  onInspectionHover?: (inspection: CanvasInspection | null) => void;
  onInspectionSelect?: (inspection: CanvasInspection | null) => void;
  activeInspection?: CanvasInspection | null;
  selectedInspectionId?: string | null;
  toolsOpen?: boolean;
  onToggleTools?: () => void;
  regionRevisions?: Record<number, number>;
  compositionRevision?: number;
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
const EMPTY_REGION_REVISIONS: Record<number, number> = {};

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
  const innerRadius = Math.min(focus.width, focus.height) * 0.35;
  const outerRadius = Math.max(focus.width, focus.height) * 0.65;
  const gradient = context.createRadialGradient(
    centerX,
    centerY,
    innerRadius,
    centerX,
    centerY,
    outerRadius,
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

  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      drawAsciiParticles(
        context,
        tileX * tileSize,
        tileY * tileSize,
        tileSize,
        tileSize,
        {
          avoid: regions.map((region) => region.ellipse),
          seed: LIVE_SEED ^
            Math.imul(tileX, 73_856_093) ^
            Math.imul(tileY, 19_349_663),
        },
      );
    }
  }
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
    if (node.punctOnly) context.font = fonts.punctuationFont();
    else if (node.isFirstInSentence) context.font = fonts.firstWordFont();
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

function InfiniteInspectionMarker({
  inspection,
  view,
  pinned,
}: {
  inspection: CanvasInspection;
  view: ViewTransform;
  pinned: boolean;
}) {
  if (inspection.canvasKind !== 'infinite') return null;
  const border = pinned
    ? '1.5px solid rgba(255,255,255,0.92)'
    : '1px dashed rgba(255,255,255,0.72)';
  if (inspection.kind === 'word') {
    const diameter = Math.max(
      18,
      (Math.max(inspection.anchor.width, inspection.anchor.height) + 14) * view.scale,
    );
    return (
      <div
        className="pointer-events-none absolute z-[8] rounded-full bg-white/[0.035]"
        data-inspection-marker="word"
        style={{
          left: view.x + inspection.anchor.x * view.scale - diameter / 2,
          top: view.y + inspection.anchor.y * view.scale - diameter / 2,
          width: diameter,
          height: diameter,
          border,
        }}
      >
        {pinned && <InspectionCornerDetails inspection={inspection} />}
      </div>
    );
  }
  const diameter = Math.max(4, Math.max(inspection.anchor.rx, inspection.anchor.ry) * 2 * view.scale);
  return (
    <div
      className="pointer-events-none absolute z-[7] rounded-full"
      data-inspection-marker="region"
      style={{
        left: view.x + inspection.anchor.x * view.scale - diameter / 2,
        top: view.y + inspection.anchor.y * view.scale - diameter / 2,
        width: diameter,
        height: diameter,
        border,
      }}
    >
      {pinned && <InspectionCornerDetails inspection={inspection} />}
    </div>
  );
}

export default function InfiniteLiveCanvas({
  passageText,
  passageHeader,
  canvasOption,
  canvasRef,
  onReadyChange,
  onInspectionHover,
  onInspectionSelect,
  activeInspection,
  selectedInspectionId,
  toolsOpen = true,
  onToggleTools,
  regionRevisions = EMPTY_REGION_REVISIONS,
  compositionRevision = 0,
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
  const inspectionRegionsRef = useRef<InspectableRegion[]>([]);
  const lastHoverIdRef = useRef<string | null>(null);
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

  const emitInspectionHover = useCallback((inspection: CanvasInspection | null) => {
    const nextId = inspection?.id ?? null;
    if (lastHoverIdRef.current === nextId) return;
    lastHoverIdRef.current = nextId;
    onInspectionHover?.(inspection);
  }, [onInspectionHover]);

  const inspectionAtPoint = useCallback((
    element: HTMLDivElement,
    clientX: number,
    clientY: number,
  ) => {
    const rect = element.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const current = viewRef.current;
    return hitTestInspection(
      'infinite',
      inspectionRegionsRef.current,
      (localX - current.x) / current.scale,
      (localY - current.y) / current.scale,
    );
  }, []);

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

  const fitView = useCallback(() => {
    if (!activeInspection || activeInspection.canvasKind !== 'infinite') {
      focusFirst();
      return;
    }
    const anchor = activeInspection.anchor;
    let width: number;
    let height: number;
    if (activeInspection.kind === 'region') {
      width = activeInspection.anchor.rx * REGION_HALO * 2;
      height = activeInspection.anchor.ry * REGION_HALO * 2;
    } else {
      width = Math.max(260, activeInspection.anchor.width * 6);
      height = Math.max(180, activeInspection.anchor.height * 6);
    }
    const air = Math.min(viewport.width, viewport.height) * 0.14;
    const scale = clampScale(Math.min(
      (viewport.width - air * 2) / Math.max(1, width),
      (viewport.height - air * 2) / Math.max(1, height),
      1,
    ));
    scheduleView({
      scale,
      x: viewport.width / 2 - anchor.x * scale,
      y: viewport.height / 2 - anchor.y * scale,
    });
    hasCenteredRef.current = true;
  }, [activeInspection, clampScale, focusFirst, scheduleView, viewport]);

  const setActualSize = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    scheduleView((current) => {
      const worldX = (viewport.width / 2 - current.x) / current.scale;
      const worldY = (viewport.height / 2 - current.y) / current.scale;
      const scale = clampScale(1);
      return {
        scale,
        x: viewport.width / 2 - worldX * scale,
        y: viewport.height / 2 - worldY * scale,
      };
    });
  }, [clampScale, scheduleView, viewport]);

  const centerInspection = useCallback((inspection: CanvasInspection | null) => {
    if (!inspection || inspection.canvasKind !== 'infinite') return;
    scheduleView((current) => ({
      ...current,
      x: viewport.width / 2 - inspection.anchor.x * current.scale,
      y: viewport.height / 2 - inspection.anchor.y * current.scale,
    }));
  }, [scheduleView, viewport]);

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
            document.fonts.load(
              `${canvasOption.WORD_SIZE}px "Star Glyphs"`,
              '\uE000',
            ),
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
            compositionRevision,
            regionRevisions[index] ?? 0,
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
        inspectionRegionsRef.current = regions.map((region, index) => ({
          paragraphIndex: index,
          sourceParagraph: paragraphs[index],
          sentenceCount: structures[index].length,
          wordSize: canvasOption.WORD_SIZE,
          nodes: region.nodes,
          links: region.links,
          ellipse: region.ellipse,
          nodesRelativeToEllipse: true,
        }));
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
      inspectionRegionsRef.current = [];
      onReadyChange?.(false);
    };
  }, [canvasOption, compositionRevision, onReadyChange, paragraphs, regionRevisions]);

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
      context.strokeStyle = 'white';
      context.lineWidth = 1;
      context.setLineDash([1, 1]);
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
        drawRadialGraph(
          context,
          region.ellipse.x,
          region.ellipse.y,
          region.ellipse.rx,
          region.ellipse.ry,
          model.regions.indexOf(region),
        );
      });
      drawVisibleParticles(context, visible, visibleRegions, view.scale);
      visibleRegions.forEach((region) => {
        drawRegion(context, region, canvasOption.WORD_SIZE);
      });

      context.save();
      context.fillStyle = 'rgba(255,255,255,0.88)';
      context.font = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE })
        .headerFont(34);
      context.textAlign = 'left';
      context.textBaseline = 'top';
      const first = model.regions[0].ellipse;
      context.fillText(
        passageHeader,
        first.x - first.rx * REGION_HALO,
        first.y - first.ry * REGION_HALO,
      );
      context.restore();
    }

    const texture = noiseRef.current;
    if (texture) {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const pattern = context.createPattern(texture, 'repeat');
      if (pattern) {
        context.globalAlpha = 0.7;
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
    emitInspectionHover(null);
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
    if (!pointersRef.current.has(event.pointerId)) {
      if (event.pointerType === 'mouse') {
        emitInspectionHover(
          inspectionAtPoint(event.currentTarget, event.clientX, event.clientY),
        );
      }
      return;
    }
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
    const rect = event.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    const wasClick = pointersRef.current.size === 1 &&
      drag?.pointerId === event.pointerId &&
      Math.hypot(
        event.clientX - rect.left - drag.clientX,
        event.clientY - rect.top - drag.clientY,
      ) <= 4;
    const clickedInspection = wasClick
      ? inspectionAtPoint(event.currentTarget, event.clientX, event.clientY)
      : null;
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
    if (wasClick) {
      emitInspectionHover(clickedInspection);
      onInspectionSelect?.(clickedInspection);
      centerInspection(clickedInspection);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? canvasOption.GRID_SIZE * 8 : canvasOption.GRID_SIZE * 3;
    if (event.key === 'Escape') onInspectionSelect?.(null);
    else if (event.key === 'ArrowLeft') scheduleView((current) => ({ ...current, x: current.x + step }));
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
      onPointerLeave={() => {
        if (!pointersRef.current.size) emitInspectionHover(null);
      }}
      style={{ touchAction: 'none', cursor: isPanning ? 'grabbing' : 'grab' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block w-full h-full"
        aria-hidden="true"
      />
      {activeInspection && (
        <InfiniteInspectionMarker
          inspection={activeInspection}
          view={view}
          pinned={activeInspection.id === selectedInspectionId}
        />
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-10 flex flex-col items-end justify-between gap-2 md:bottom-auto md:flex-row md:items-center md:justify-start">
        <div className="pointer-events-auto order-2 flex items-center gap-1 rounded-sm bg-black/55 px-3 py-1.5 shadow-[0_1px_8px_rgba(0,0,0,0.22)] backdrop-blur-md md:order-1">
        <button
          type="button"
          className="no-format px-1 text-xs text-white/75"
          aria-label="Fit selected region or first region"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            fitView();
          }}
        >
          [fit]
        </button>
        <button
          type="button"
          className="no-format px-1 text-xs text-white/75"
          aria-label="Show at 100 percent"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setActualSize();
          }}
        >
          [100%]
        </button>
        <button
          type="button"
          className="no-format px-1 text-xs text-white/75"
          aria-label="Show all regions"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            fitAll();
          }}
        >
          [all]
        </button>
        <span className="status-signal min-w-12 px-1 text-center text-[10px] text-white/65" aria-label="Current zoom">
          {Math.round(view.scale * 100)}%
        </span>
        <button
          type="button"
          className="no-format px-1 text-xs text-white/75"
          aria-label="Reset view"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onInspectionSelect?.(null);
            emitInspectionHover(null);
            focusFirst();
          }}
        >
          {'<reset>'}
        </button>
        </div>
        {onToggleTools && (
          <button
            type="button"
            className="no-format pointer-events-auto order-1 px-1 text-xs text-white md:order-2"
            aria-label={toolsOpen ? 'Hide controls' : 'Open controls'}
            aria-pressed={toolsOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleTools();
            }}
          >
            {toolsOpen ? '<hide tools>' : '<tools>'}
          </button>
        )}
      </div>
      {(isBuilding || error) && (
        <div
          className="status-signal pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#121c2d]/70 px-8 text-center text-[11px] text-white/75"
          role={error ? 'alert' : 'status'}
        >
          {error || 'settling the live field…'}
        </div>
      )}
    </div>
  );
}
