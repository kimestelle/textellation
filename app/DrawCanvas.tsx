'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { forceCollide, forceSimulation } from 'd3-force';
import type { Simulation } from 'd3-force';

import { tightPack, ellipseSizeFromWords } from './helpers/paragraphHelpers';
import { tokenizeAndBucket } from './helpers/posHelpers';
import {
  drawAsciiParticles,
  drawBackgroundGrid,
  drawBlendedWhiteText,
  drawBurnedEllipseConnector,
  drawHeader,
  drawRadialGraph,
  drawWrappedColumns,
  punctToASCIIStar,
  DEEPBLUEGREEN_HEX
} from './helpers/drawHelpers';
import { FixedCanvasOption } from './settings/canvasOptions';
import { hashString, seededRandom } from './helpers/randomHelpers';
import {
  hitTestInspection,
  type CanvasInspection,
  type InspectableRegion,
} from './helpers/inspectionHelpers';
import InspectionCornerDetails from './components/InspectionCornerDetails';
import {
  COMPOSITION_PRESETS,
  type CompositionPresetId,
} from './settings/compositionPresets';
import {
  DEFAULT_RENDER_VISIBILITY,
  type RenderVisibility,
} from './settings/renderVisibility';

import {
  clampEllipse,
  countGlyphOverlaps,
  makeFonts,
  buildParagraphSim,
  resolveGlyphOverlaps,
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
  onBuildStateChange?: (busy: boolean) => void;
  onRenderError?: (message: string | null) => void;
  onInspectionHover?: (inspection: CanvasInspection | null) => void;
  onInspectionSelect?: (inspection: CanvasInspection | null) => void;
  activeInspection?: CanvasInspection | null;
  selectedInspectionId?: string | null;
  toolsOpen?: boolean;
  onToggleTools?: () => void;
  regionRevisions?: Record<number, number>;
  compositionRevision?: number;
  compositionPreset?: CompositionPresetId;
  renderVisibility?: RenderVisibility;
};

type FixedViewMode = 'fit' | '100' | 'all';
type FixedViewTransform = { tx: number; ty: number; zoom: number };

const imagePromises = new Map<string, Promise<HTMLImageElement | null>>();
const EMPTY_REGION_REVISIONS: Record<number, number> = {};

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

function resolveWithin<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
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
    const clamped = clampEllipse(
      node.x ?? group.ellipse.x,
      node.y ?? group.ellipse.y,
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

function FixedInspectionMarker({
  inspection,
  pinned,
  offsetX,
  offsetY,
}: {
  inspection: CanvasInspection;
  pinned: boolean;
  offsetX: number;
  offsetY: number;
}) {
  if (inspection.canvasKind !== 'fixed') return null;
  const border = pinned
    ? '1.5px solid rgba(255,255,255,0.92)'
    : '1px dashed rgba(255,255,255,0.72)';
  if (inspection.kind === 'word') {
    const diameter = Math.max(inspection.anchor.width, inspection.anchor.height) + 14;
    return (
      <div
        className="pointer-events-none absolute z-[8] rounded-full bg-white/[0.035]"
        data-inspection-marker="word"
        style={{
          left: offsetX + inspection.anchor.x - diameter / 2,
          top: offsetY + inspection.anchor.y - diameter / 2,
          width: diameter,
          height: diameter,
          border,
        }}
      >
        {pinned && <InspectionCornerDetails inspection={inspection} />}
      </div>
    );
  }
  const diameter = Math.max(inspection.anchor.rx, inspection.anchor.ry) * 2;
  return (
    <div
      className="pointer-events-none absolute z-[7] rounded-full"
      data-inspection-marker="region"
      style={{
        left: offsetX + inspection.anchor.x - diameter / 2,
        top: offsetY + inspection.anchor.y - diameter / 2,
        width: diameter,
        height: diameter,
        border,
      }}
    >
      {pinned && <InspectionCornerDetails inspection={inspection} />}
    </div>
  );
}

export default function DrawCanvas({
  passageText,
  passageHeader,
  canvasOption,
  canvasRef,
  bgRef,
  onReadyChange,
  onBuildStateChange,
  onRenderError,
  onInspectionHover,
  onInspectionSelect,
  activeInspection,
  selectedInspectionId,
  toolsOpen = true,
  onToggleTools,
  regionRevisions = EMPTY_REGION_REVISIONS,
  compositionRevision = 0,
  compositionPreset = 'baseline',
  renderVisibility = DEFAULT_RENDER_VISIBILITY,
}: CanvasProps) {
  // scale view to wrapper
  const [scale, setScale] = useState(1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const inspectionRegionsRef = useRef<InspectableRegion[]>([]);
  const passageHeaderRef = useRef(passageHeader);
  const lastHitRef = useRef<CanvasInspection | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);
  const touchProbeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const restViewRef = useRef<FixedViewTransform>({ tx: 0, ty: 0, zoom: 1 });
  const visibilityRef = useRef(renderVisibility);
  const redrawVisualsRef = useRef<() => void>(() => {});
  const redrawBackgroundRef = useRef<() => void>(() => {});
  const redrawForegroundRef = useRef<() => void>(() => {});
  const redrawHeaderRef = useRef<() => void>(() => {});
  const [viewMode, setViewMode] = useState<FixedViewMode>('fit');

  const BG_WIDTH = canvasOption.W + 2 * canvasOption.BG_SIDE_MARGIN;
  const BG_HEIGHT = canvasOption.H + canvasOption.BG_TOP_MARGIN + canvasOption.BG_BOTTOM_MARGIN;
  const INNER_X = canvasOption.BG_SIDE_MARGIN;
  const INNER_Y = canvasOption.BG_TOP_MARGIN;
  // Mobile Safari is prone to reloading the tab when the two poster canvases
  // and their composited layers are all allocated at export resolution. Keep
  // the canvas coordinate system intact while using a lighter preview bitmap
  // on narrow/coarse-pointer devices. Desktop previews remain full resolution.
  const previewResolution = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    const mobileViewport = window.matchMedia('(max-width: 1023px)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (!mobileViewport && !coarsePointer) return 1;

    // Bound the two visible layers and the temporary swap layers together.
    // The large poster otherwise retains more than 24 MB of canvas backing
    // stores during a format change, before Safari accounts for textures and
    // compositing surfaces. Smaller formats can keep the sharper 0.5 preview.
    const logicalPixels =
      canvasOption.W * canvasOption.H + BG_WIDTH * BG_HEIGHT;
    const pixelBudgetScale = Math.sqrt(1_600_000 / logicalPixels);
    const dimensionBudgetScale = 1152 / Math.max(BG_WIDTH, BG_HEIGHT);
    return Math.max(
      0.25,
      Math.min(0.5, pixelBudgetScale, dimensionBudgetScale),
    );
  }, [BG_HEIGHT, BG_WIDTH, canvasOption.H, canvasOption.W]);
  const previewWidth = Math.max(1, Math.round(canvasOption.W * previewResolution));
  const previewHeight = Math.max(1, Math.round(canvasOption.H * previewResolution));
  const previewBgWidth = Math.max(1, Math.round(BG_WIDTH * previewResolution));
  const previewBgHeight = Math.max(1, Math.round(BG_HEIGHT * previewResolution));
  const dynamics = COMPOSITION_PRESETS[compositionPreset].dynamics;

  useEffect(() => {
    const previous = visibilityRef.current;
    visibilityRef.current = renderVisibility;
    const wordEdgesChanged =
      previous.orderEdges !== renderVisibility.orderEdges ||
      previous.punctuationEdges !== renderVisibility.punctuationEdges ||
      previous.strongPosEdges !== renderVisibility.strongPosEdges ||
      previous.weakPosEdges !== renderVisibility.weakPosEdges;
    const fieldLayersChanged =
      previous.grid !== renderVisibility.grid ||
      previous.particles !== renderVisibility.particles ||
      previous.ellipseSpokes !== renderVisibility.ellipseSpokes ||
      previous.ellipses !== renderVisibility.ellipses ||
      previous.ellipseLabels !== renderVisibility.ellipseLabels ||
      previous.ellipseConnectors !== renderVisibility.ellipseConnectors;

    if (wordEdgesChanged && fieldLayersChanged) {
      redrawVisualsRef.current();
    } else if (wordEdgesChanged) {
      redrawForegroundRef.current();
    } else if (fieldLayersChanged) {
      redrawBackgroundRef.current();
    }
  }, [renderVisibility]);

  useEffect(() => {
    passageHeaderRef.current = passageHeader;
    redrawHeaderRef.current();
  }, [passageHeader]);

  const viewZoom = useMemo(() => {
    if (viewMode === 'fit') {
      return Math.min(BG_WIDTH / canvasOption.W, BG_HEIGHT / canvasOption.H);
    }
    return viewMode === '100' ? 1 / Math.max(0.0001, scale) : 1;
  }, [BG_HEIGHT, BG_WIDTH, canvasOption.H, canvasOption.W, scale, viewMode]);

  const emitInspectionHover = useCallback((inspection: CanvasInspection | null) => {
    const nextId = inspection?.id ?? null;
    if (lastHoverIdRef.current === nextId) return;
    lastHoverIdRef.current = nextId;
    lastHitRef.current = inspection;
    onInspectionHover?.(inspection);
  }, [onInspectionHover]);

  const applyRestView = useCallback((mode: FixedViewMode, animate = true) => {
    const zoomEl = zoomRef.current;
    let zoom = 1;
    if (mode === 'fit') {
      zoom = Math.min(BG_WIDTH / canvasOption.W, BG_HEIGHT / canvasOption.H);
    } else if (mode === '100') {
      zoom = 1 / Math.max(0.0001, scale);
    }
    const contentWidth = mode === 'fit' ? canvasOption.W : BG_WIDTH;
    const contentHeight = mode === 'fit' ? canvasOption.H : BG_HEIGHT;
    const contentX = mode === 'fit' ? INNER_X : 0;
    const contentY = mode === 'fit' ? INNER_Y : 0;
    const next = {
      zoom,
      tx: (BG_WIDTH - contentWidth * zoom) / 2 - contentX * zoom,
      ty: (BG_HEIGHT - contentHeight * zoom) / 2 - contentY * zoom,
    };
    restViewRef.current = next;
    if (!zoomEl) return;
    zoomEl.style.transition = animate ? 'transform 220ms ease-out' : 'none';
    zoomEl.style.transformOrigin = 'top left';
    zoomEl.style.transform = `translate(${next.tx}px, ${next.ty}px) scale(${next.zoom})`;
    zoomEl.style.setProperty(
      '--inspection-label-scale',
      String(1 / Math.max(0.0001, scale * next.zoom)),
    );
  }, [BG_HEIGHT, BG_WIDTH, INNER_X, INNER_Y, canvasOption.H, canvasOption.W, scale]);

  const selectView = useCallback((mode: FixedViewMode) => {
    setViewMode(mode);
    emitInspectionHover(null);
    applyRestView(mode);
  }, [applyRestView, emitInspectionHover]);

  const startTouchProbe = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    if ((event.target as Element).closest('[data-canvas-controls]')) return;
    touchProbeRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  const moveTouchProbe = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const probe = touchProbeRef.current;
    if (!probe || probe.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - probe.x, event.clientY - probe.y) > 8) {
      touchProbeRef.current = null;
    }
  }, []);

  const endTouchProbe = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    if ((event.target as Element).closest('[data-canvas-controls]')) {
      touchProbeRef.current = null;
      return;
    }
    suppressNextClickRef.current = true;
    const probe = touchProbeRef.current;
    touchProbeRef.current = null;
    if (!probe || probe.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - probe.x, event.clientY - probe.y) > 8) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const screenX = (event.clientX - rect.left) / Math.max(0.0001, scale);
    const screenY = (event.clientY - rect.top) / Math.max(0.0001, scale);
    const rest = restViewRef.current;
    const worldX = (screenX - rest.tx) / Math.max(0.0001, rest.zoom);
    const worldY = (screenY - rest.ty) / Math.max(0.0001, rest.zoom);
    const inspection = hitTestInspection(
      'fixed',
      inspectionRegionsRef.current,
      worldX - INNER_X,
      worldY - INNER_Y,
    );
    emitInspectionHover(null);
    lastHitRef.current = inspection;
    onInspectionSelect?.(inspection);
  }, [INNER_X, INNER_Y, emitInspectionHover, onInspectionSelect, scale]);

  const cancelTouchProbe = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchProbeRef.current?.pointerId === event.pointerId) {
      touchProbeRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    applyRestView(viewMode, false);
  }, [applyRestView, viewMode]);

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

  // Zoom on mouse hover. Touch keeps the specimen still so a page scroll does
  // not continuously move and repaint the camera underneath the finger.
  useEffect(() => {
    const wrapperEl = wrapperRef.current;
    const zoomEl = zoomRef.current;
    if (!wrapperEl || !zoomEl) return;

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
      const screenX = mx / scale;
      const screenY = my / scale;

      const fitZoom = Math.min(BG_WIDTH / canvasOption.W, BG_HEIGHT / canvasOption.H);
      const fitRestTx = (BG_WIDTH - canvasOption.W * fitZoom) / 2 - INNER_X * fitZoom;
      const fitRestTy = (BG_HEIGHT - canvasOption.H * fitZoom) / 2 - INNER_Y * fitZoom;
      const restView = restViewRef.current;
      const actualSizeScale = 1 / Math.max(0.0001, scale);
      const targetScale = Math.min(
        Math.max(0.0001, restView.zoom) * 3,
        actualSizeScale,
      );

      // Resolve the raw cursor point through the canonical fit map.
      const cameraX = (screenX - fitRestTx) / fitZoom;
      const cameraY = (screenY - fitRestTy) / fitZoom;
      const wrapperCenterX = (
        wrapperRect.left + wrapperRect.width / 2 - stageRect.left
      ) / scale;
      const wrapperCenterY = (
        wrapperRect.top + wrapperRect.height / 2 - stageRect.top
      ) / scale;

      const cameraForScale = (zoom: number) => {
        const minTx = stageRect.width / scale - BG_WIDTH * zoom;
        const minTy = stageRect.height / scale - BG_HEIGHT * zoom;
        return {
          tx: Math.min(0, Math.max(minTx, wrapperCenterX - cameraX * zoom)),
          ty: Math.min(0, Math.max(minTy, wrapperCenterY - cameraY * zoom)),
        };
      };

      // Keep fit's familiar post-camera pointer probe as the source of truth,
      // while the visible camera uses the selected view's own zoom degree.
      const pointerScale = Math.max(0.0001, fitZoom) * 3;
      const pointerCamera = cameraForScale(pointerScale);
      const probeX = (screenX - pointerCamera.tx) / pointerScale;
      const probeY = (screenY - pointerCamera.ty) / pointerScale;
      const minTargetTx = stageRect.width / scale - BG_WIDTH * targetScale;
      const minTargetTy = stageRect.height / scale - BG_HEIGHT * targetScale;
      // Keep the canonical fit probe under the physical pointer even when the
      // selected view uses a different zoom degree (notably 100%).
      const tx = Math.min(
        0,
        Math.max(minTargetTx, screenX - probeX * targetScale),
      );
      const ty = Math.min(
        0,
        Math.max(minTargetTy, screenY - probeY * targetScale),
      );
      zoomEl.style.transition = 'none';
      zoomEl.style.transformOrigin = 'top left';
      zoomEl.style.transform = `translate(${tx}px, ${ty}px) scale(${targetScale})`;
      zoomEl.style.setProperty(
        '--inspection-label-scale',
        String(1 / Math.max(0.0001, scale * targetScale)),
      );

      emitInspectionHover(
        hitTestInspection(
          'fixed',
          inspectionRegionsRef.current,
          probeX - INNER_X,
          probeY - INNER_Y,
        ),
      );
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

      emitInspectionHover(null);
      zoomEl.style.transition = 'transform 220ms ease-out';
      zoomEl.style.transformOrigin = 'top left';
      const restView = restViewRef.current;
      zoomEl.style.transform = `translate(${restView.tx}px, ${restView.ty}px) scale(${restView.zoom})`;
      zoomEl.style.setProperty(
        '--inspection-label-scale',
        String(1 / Math.max(0.0001, scale * restView.zoom)),
      );
    };

    wrapperEl.addEventListener('mousemove', onMove);
    wrapperEl.addEventListener('mouseleave', onLeave);

    return () => {
      wrapperEl.removeEventListener('mousemove', onMove);
      wrapperEl.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    BG_WIDTH,
    BG_HEIGHT,
    INNER_X,
    INNER_Y,
    canvasOption.H,
    canvasOption.W,
    emitInspectionHover,
    scale,
  ]);
  const paragraphs = useMemo(
    () => passageText
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean),
    [passageText],
  );

  // paragraphs -> sentences
  const structure = useMemo(() => {
    return paragraphs.map((p) =>
      (p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p])
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [paragraphs]);

  const paragraphWordCounts = useMemo(() => {
    return structure.map((sentences) =>
      sentences.reduce((total, sentence) => {
        const tagged = tokenizeAndBucket(sentence);
        return total + tagged.buckets.filter((bucket) => bucket !== 'PUNC').length;
      }, 0),
    );
  }, [structure]);

  // paragraph ellipse sizes
  const sizes = useMemo(() => {
    return structure.map((sentences) => {
      const wc = sentences.reduce(
        (total, sentence) => total + tokenizeAndBucket(sentence).tokens.length,
        0,
      );
      const size = ellipseSizeFromWords(
        wc,
        canvasOption.W - 2 * canvasOption.MARGIN,
        { minS: 220, maxS: 700, mix: 0.1 }
      );
      return {
        rx: size.rx * dynamics.regionScale,
        ry: size.ry * dynamics.regionScale,
      };
    });
  }, [structure, canvasOption, dynamics.regionScale]);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let animationFrame = 0;
    let releaseRenderBuffers = () => {};
    const sims: Array<Simulation<WordNode, undefined>> = [];
    redrawVisualsRef.current = () => {};
    redrawBackgroundRef.current = () => {};
    redrawForegroundRef.current = () => {};
    redrawHeaderRef.current = () => {};
    onRenderError?.(null);
    onReadyChange?.(false);
    onBuildStateChange?.(true);

    const finish = (ready: boolean) => {
      if (cancelled || settled) return;
      settled = true;
      onReadyChange?.(ready);
      onBuildStateChange?.(false);
    };

    const render = async () => {
      const visibleFg = canvasRef.current;
      const visibleBg = bgRef.current;
      if (!visibleFg || !visibleBg) {
        onRenderError?.('canvas is unavailable');
        finish(false);
        return;
      }
      const constrainedBuild = window.matchMedia(
        '(max-width: 1023px), (pointer: coarse)',
      ).matches;
      // Render mobile format changes into a detached pair of canvases. Changing
      // a visible canvas's backing dimensions clears it immediately, which left
      // an empty specimen during slower queued builds. The completed layers are
      // copied into the visible pair together at the end of the build.
      const stagingFg = constrainedBuild ? document.createElement('canvas') : visibleFg;
      const stagingBg = constrainedBuild ? document.createElement('canvas') : visibleBg;
      let fg = stagingFg;
      let bg = stagingBg;
      let staging = constrainedBuild;
      fg.width = previewWidth;
      fg.height = previewHeight;
      bg.width = previewBgWidth;
      bg.height = previewBgHeight;
      const releaseStagingBuffers = () => {
        if (!constrainedBuild) return;
        stagingFg.width = 1;
        stagingFg.height = 1;
        stagingBg.width = 1;
        stagingBg.height = 1;
      };
      releaseRenderBuffers = releaseStagingBuffers;
      const initialContext = fg.getContext('2d');
      const initialBackgroundContext = bg.getContext('2d');
      if (!initialContext || !initialBackgroundContext) {
        releaseStagingBuffers();
        onRenderError?.('canvas is unavailable');
        finish(false);
        return;
      }
      let ctx: CanvasRenderingContext2D = initialContext;
      let bgctx: CanvasRenderingContext2D = initialBackgroundContext;
      const presentSettledBuffers = () => {
        if (!staging) return true;
        if (cancelled) return false;
        try {
          const visibleContext = visibleFg.getContext('2d');
          const visibleBackgroundContext = visibleBg.getContext('2d');
          if (!visibleContext || !visibleBackgroundContext) return false;

          // Resize and paint both visible layers in the same task so the browser
          // cannot show a half-swapped poster between animation frames.
          visibleBg.width = previewBgWidth;
          visibleBg.height = previewBgHeight;
          visibleFg.width = previewWidth;
          visibleFg.height = previewHeight;
          visibleBackgroundContext.clearRect(0, 0, previewBgWidth, previewBgHeight);
          visibleBackgroundContext.drawImage(stagingBg, 0, 0);
          visibleContext.clearRect(0, 0, previewWidth, previewHeight);
          visibleContext.drawImage(stagingFg, 0, 0);
          visibleFg.dataset.wordOverlaps = stagingFg.dataset.wordOverlaps ?? '';
          visibleFg.dataset.renderStage = stagingFg.dataset.renderStage ?? '';

          // Future visibility/header paints go straight to the visible pair.
          // Releasing the detached pair here prevents every settled poster from
          // permanently retaining a second full set of mobile canvas buffers.
          fg = visibleFg;
          bg = visibleBg;
          ctx = visibleContext;
          bgctx = visibleBackgroundContext;
          ctx.setTransform(previewResolution, 0, 0, previewResolution, 0, 0);
          bgctx.setTransform(previewResolution, 0, 0, previewResolution, 0, 0);
          staging = false;
          releaseStagingBuffers();
          return true;
        } catch {
          return false;
        }
      };

      try {
        const fontReady = document.fonts
          ? Promise.all([
              document.fonts.load(`${canvasOption.WORD_SIZE}px Newsreader`),
              document.fonts.load(
                `${canvasOption.WORD_SIZE}px "Star Glyphs"`,
                '\uE000',
              ),
              document.fonts.ready,
            ])
          : Promise.resolve();
        const [, noise, compass] = await resolveWithin(
          Promise.all([
            fontReady,
            loadCanvasImage('/noisy.png'),
            canvasOption.showText ? loadCanvasImage('/compass.png') : Promise.resolve(null),
          ]),
          [undefined, null, null] as [undefined, null, null],
          2500,
        );
        if (cancelled) return;

        fg.dataset.wordOverlaps = 'settling';
        fg.dataset.renderStage = 'assets-ready';
        ctx.setTransform(previewResolution, 0, 0, previewResolution, 0, 0);
        bgctx.setTransform(previewResolution, 0, 0, previewResolution, 0, 0);

        const IX = INNER_X;
        const IY = INNER_Y;
        const IW = canvasOption.W;
        const IH = canvasOption.H;
        const packAtScale = (scaleFactor: number) => tightPack(
          IW - 2 * canvasOption.MARGIN,
          IH - 2 * canvasOption.MARGIN,
          canvasOption.WORD_SIZE,
          scaleFactor === 1
            ? sizes
            : sizes.map((size) => ({
                rx: size.rx * scaleFactor,
                ry: size.ry * scaleFactor,
              })),
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
        let packed = packAtScale(1);
        // Wide presets such as Field can legitimately exceed a compact output
        // format even after the text itself passes validation. Preserve the
        // preset's relative geometry, but shrink its regions until the selected
        // card has a valid packing instead of leaving the renderer terminally
        // blank.
        for (const fallbackScale of [0.86, 0.72, 0.6, 0.5]) {
          if (packed !== 'FAIL') break;
          packed = packAtScale(fallbackScale);
        }

        if (packed === 'FAIL') {
          fg.dataset.renderStage = 'pack-failed';
          fg.dataset.wordOverlaps = 'not-rendered';
          bgctx.clearRect(0, 0, BG_WIDTH, BG_HEIGHT);
          bgctx.fillStyle = 'white';
          bgctx.fillRect(0, 0, BG_WIDTH, BG_HEIGHT);
          ctx.clearRect(0, 0, canvasOption.W, canvasOption.H);
          ctx.fillStyle = '#b00020';
          ctx.font = `${canvasOption.WORD_SIZE * 2}px Newsreader`;
          ctx.fillText('Content cannot fit, please enter a shorter passage.', 40, 100);
          releaseStagingBuffers();
          onRenderError?.('canvas could not fit this format');
          finish(false);
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

        const fonts = makeFonts({ family: 'Newsreader', wordPx: canvasOption.WORD_SIZE });
        const drawPaperHeader = () => {
          if (cancelled) return;
          bgctx.fillStyle = 'white';
          bgctx.fillRect(0, 0, BG_WIDTH, IY);
          if (!canvasOption.showTitle) return;
          drawHeader(
            bgctx,
            passageHeaderRef.current,
            canvasOption.BG_SIDE_MARGIN + canvasOption.MARGIN,
            canvasOption.BG_TOP_MARGIN / 2,
            {
              font: fonts.headerFont(canvasOption.HEADER_SIZE),
              color: '#000',
              logicalCanvasWidth: BG_WIDTH,
            },
          );
        };
        redrawHeaderRef.current = () => {
          drawPaperHeader();
        };
        const drawBackground = () => {
          if (cancelled) return;
          const layers = visibilityRef.current;
          bgctx.clearRect(0, 0, BG_WIDTH, BG_HEIGHT);
          bgctx.fillStyle = 'white';
          bgctx.fillRect(0, 0, BG_WIDTH, BG_HEIGHT);
          drawBackgroundGrid(
            bgctx,
            IX,
            IY,
            IW,
            IH,
            canvasOption.GRID_SIZE,
            0.4,
            layers.grid ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0)',
            canvasOption.MARGIN,
          );

          if (layers.ellipseConnectors) {
            for (let index = 0; index < shifted.length - 1; index += 1) {
              drawBurnedEllipseConnector(
                bgctx,
                shifted[index],
                shifted[index + 1],
              );
            }
          }
          if (layers.ellipses || layers.ellipseSpokes || layers.ellipseLabels) {
            shifted.forEach((ellipse, index) => {
              drawRadialGraph(
                bgctx,
                ellipse.x,
                ellipse.y,
                ellipse.rx,
                ellipse.ry,
                index,
                {
                  visibleBounds: { x: IX, y: IY, width: IW, height: IH },
                  wordCount: paragraphWordCounts[index],
                  showEllipse: layers.ellipses,
                  showSpokes: layers.ellipseSpokes,
                  showLabel: layers.ellipseLabels,
                },
              );
            });
          }
          if (layers.particles) {
            drawAsciiParticles(bgctx, IX, IY, IW, IH, {
              avoid: shifted,
              seed: dynamics.seed,
            });
          }

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
          bgctx.fillRect(0, 0, BG_WIDTH, IY);
          bgctx.fillRect(0, IY + IH, BG_WIDTH, BG_HEIGHT - (IY + IH));
          bgctx.fillRect(0, 0, IX, BG_HEIGHT);
          bgctx.fillRect(IX + IW, 0, BG_WIDTH - (IX + IW), BG_HEIGHT);

          drawPaperHeader();
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
        };
        // Keep the previous mobile poster intact while its replacement settles.
        // Both layers are redrawn together below, immediately before ready.
        if (!constrainedBuild) drawBackground();

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
              hashString(
                `${dynamics.seed}:${paragraph}:${structure[paragraph].join(' ')}:${compositionRevision}:${regionRevisions[paragraph] ?? 0}`,
              ),
            ),
            dynamics,
          });
          paragraphNodes.push(nodes);
          paragraphLinks.push(links);
          collisionGroups.push({ ellipse: parEllipse, nodes });
          sims.push(sim);
        }
        inspectionRegionsRef.current = collisionGroups.map((group, paragraph) => ({
          paragraphIndex: paragraph,
          sourceParagraph: paragraphs[paragraph],
          sentenceCount: structure[paragraph].length,
          wordSize: canvasOption.WORD_SIZE,
          nodes: group.nodes,
          links: paragraphLinks[paragraph],
          ellipse: group.ellipse,
        }));
        fg.dataset.renderStage = 'simulations-built';
        const fieldLayout = compositionPreset === 'field';
        const allNodes = collisionGroups.flatMap((group) => group.nodes);
        const collisionPoints: CollisionPoint[] = fieldLayout
          ? []
          : allNodes.map((node) => ({
              x: node.x,
              y: node.y,
              vx: 0,
              vy: 0,
              r: node.r,
            }));
        const globalCollisionSim = fieldLayout
          ? null
          : forceSimulation<CollisionPoint>(collisionPoints)
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
          const layers = visibilityRef.current;
          ctx.clearRect(0, 0, canvasOption.W, canvasOption.H);
          for (const links of paragraphLinks) {
            for (const link of links) {
              if (
                (link.kind === 'order' && !layers.orderEdges) ||
                (link.kind === 'punct' && !layers.punctuationEdges) ||
                (link.kind === 'samePOS' && !layers.strongPosEdges) ||
                (link.kind === 'samePOSWeak' && !layers.weakPosEdges)
              ) {
                continue;
              }
              const source = typeof link.source === 'number' ? null : link.source;
              const target = typeof link.target === 'number' ? null : link.target;
              if (!source || !target) continue;
              const dotted = link.kind === 'punct' || source.punctOnly || target.punctOnly;
              const weak = link.kind === 'order';
              const sequence = weak || link.kind === 'punct';
              ctx.strokeStyle = fieldLayout
                ? sequence
                  ? DEEPBLUEGREEN_HEX
                  : 'rgba(255,255,255,0.16)'
                : weak
                  ? DEEPBLUEGREEN_HEX
                  : 'rgba(255,255,255,0.50)';
              ctx.setLineDash(dotted ? [3, 3] : weak ? [1, 2] : []);
              ctx.lineWidth = fieldLayout ? (sequence ? 0.85 : 0.6) : weak ? 0.6 : 1;
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
              if (node.punctOnly) ctx.font = fonts.punctuationFont();
              else if (node.isFirstInSentence) ctx.font = fonts.firstWordFont();
              else if (node.bucket === 'ADJ') ctx.font = fonts.adjectiveFont();
              else if (node.bucket === 'NOUN') ctx.font = fonts.nounFont();
              else if (node.bucket === 'VERB') ctx.font = fonts.verbFont();
              else ctx.font = fonts.normalFont();
              drawBlendedWhiteText(
                ctx,
                node.punctOnly ? punctToASCIIStar(node.text) : node.text,
                node.x ?? 0,
                node.y ?? 0,
              );
            }
          }
        };
        const drawSettledFrame = () => {
          try {
            if (constrainedBuild) drawBackground();
            drawFrame();
            if (presentSettledBuffers()) return true;
          } catch {
            // Report below with the same recoverable terminal state.
          }
          releaseStagingBuffers();
          onRenderError?.('canvas could not finish this format');
          return false;
        };
        redrawVisualsRef.current = () => {
          if (constrainedBuild && !settled) return;
          drawBackground();
          drawFrame();
        };
        redrawBackgroundRef.current = () => {
          if (constrainedBuild && !settled) return;
          drawBackground();
        };
        redrawForegroundRef.current = () => {
          if (constrainedBuild && !settled) return;
          drawFrame();
        };

        const tickAll = (ticks: number) => {
          // Field runs its long, ordered sentence springs without the shared
          // circular collision pass used by the clustered presets.
          if (fieldLayout) {
            for (let tick = 0; tick < ticks; tick += 1) {
              sims.forEach((simulation) => simulation.tick());
            }
            return;
          }
          if (!globalCollisionSim) return;
          const bounds = {
            width: canvasOption.W,
            height: canvasOption.H,
            padding: canvasOption.MARGIN,
          };
          for (let tick = 0; tick < ticks; tick += 1) {
            sims.forEach((simulation) => simulation.tick());
            collisionGroups.forEach((group) => clampGroup(group));
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

        const yieldBuild = () => new Promise<void>((resolve) => {
          if (document.hidden) {
            window.setTimeout(resolve, 0);
            return;
          }
          animationFrame = window.requestAnimationFrame(() => resolve());
        });

        const finishFieldCollisions = async () => {
          if (constrainedBuild) {
            for (let tick = 0; tick < 64; tick += 4) {
              tickAll(4);
              if (cancelled) return false;
              if (tick < 60) await yieldBuild();
            }
          } else {
            tickAll(64);
          }
          let clean = false;
          if (constrainedBuild) {
            for (let pass = 0; pass < 96; pass += 4) {
              clean = resolveGlyphOverlaps(allNodes, 4);
              if (clean || cancelled) break;
              if (pass < 92) await yieldBuild();
            }
          } else {
            clean = resolveGlyphOverlaps(allNodes, 96);
          }
          if (cancelled) return false;
          const overlapCount = countGlyphOverlaps(allNodes);
          fg.dataset.wordOverlaps = String(overlapCount);
          fg.dataset.renderStage = 'settled';
          if (overlapCount > 0) {
            ctx.clearRect(0, 0, canvasOption.W, canvasOption.H);
            ctx.fillStyle = '#f0b4b4';
            ctx.font = '24px Newsreader, serif';
            ctx.fillText('This passage is too dense to place without overlap.', 40, 80);
            releaseStagingBuffers();
            onRenderError?.('canvas could not place this passage without overlap');
            finish(false);
            return false;
          }
          return true;
        };

        const finishCollisions = () => {
          if (!globalCollisionSim) return false;
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
            ctx.clearRect(0, 0, canvasOption.W, canvasOption.H);
            ctx.fillStyle = '#f0b4b4';
            ctx.font = '24px Newsreader, serif';
            ctx.fillText('This passage is too dense to place without overlap.', 40, 80);
            releaseStagingBuffers();
            onRenderError?.('canvas could not place this passage without overlap');
            finish(false);
            return false;
          }
          return true;
        };

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reducedMotion || document.hidden) {
          tickAll(32);
          if (fieldLayout) {
            if (await finishFieldCollisions()) {
              const ready = drawSettledFrame();
              finish(ready);
            }
            return;
          }
          if (finishCollisions()) {
            const ready = drawSettledFrame();
            finish(ready);
          }
          return;
        }

        let frame = 0;
        const advance = () => {
          if (cancelled) return;
          tickAll(4);
          frame += 1;
          if (frame < 8) {
            if (!constrainedBuild) drawFrame();
            animationFrame = window.requestAnimationFrame(advance);
          } else {
            if (fieldLayout) {
              void finishFieldCollisions().then((ready) => {
                if (!ready || cancelled) return;
                const presented = drawSettledFrame();
                finish(presented);
              });
              return;
            }
            if (finishCollisions()) {
              const ready = drawSettledFrame();
              finish(ready);
            }
          }
        };
        animationFrame = window.requestAnimationFrame(advance);
      } catch {
        if (cancelled) return;
        bgctx.clearRect(0, 0, BG_WIDTH, BG_HEIGHT);
        ctx.clearRect(0, 0, canvasOption.W, canvasOption.H);
        ctx.fillStyle = '#f0b4b4';
        ctx.font = '24px Newsreader, serif';
        ctx.fillText('The canvas could not render. Try a shorter passage.', 40, 80);
        releaseStagingBuffers();
        onRenderError?.('canvas could not render this format');
        finish(false);
      }
    };

    void render();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      redrawVisualsRef.current = () => {};
      redrawBackgroundRef.current = () => {};
      redrawForegroundRef.current = () => {};
      redrawHeaderRef.current = () => {};
      releaseRenderBuffers();
      sims.forEach((simulation) => simulation.stop());
      inspectionRegionsRef.current = [];
      onReadyChange?.(false);
      if (!settled) onBuildStateChange?.(false);
    };
  }, [
    BG_WIDTH, BG_HEIGHT,
    INNER_X, INNER_Y,
    canvasOption, canvasRef, bgRef,
    compositionPreset,
    previewResolution, previewWidth, previewHeight, previewBgWidth, previewBgHeight,
    passageText,
    paragraphs, paragraphWordCounts, regionRevisions, compositionRevision, sizes, structure,
    dynamics, onBuildStateChange, onReadyChange, onRenderError,
  ]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
      role="region"
      tabIndex={0}
      aria-label="Textellation canvas. Hover to inspect and click to pin a word or paragraph region."
      onPointerDown={startTouchProbe}
      onPointerMove={moveTouchProbe}
      onPointerUp={endTouchProbe}
      onPointerCancel={cancelTouchProbe}
      onClick={() => {
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        onInspectionSelect?.(lastHitRef.current);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        onInspectionSelect?.(null);
        event.preventDefault();
      }}
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
            className="absolute inset-0"
          >
            <canvas
              ref={bgRef}
              className="absolute inset-0 z-[1] block"
              style={{ width: BG_WIDTH, height: BG_HEIGHT }}
            />
            <canvas
              ref={canvasRef}
              className="absolute z-[6] block"
              style={{
                top: canvasOption.BG_TOP_MARGIN,
                left: canvasOption.BG_SIDE_MARGIN,
                width: canvasOption.W,
                height: canvasOption.H,
              }}
            />
            {activeInspection && (
              <FixedInspectionMarker
                inspection={activeInspection}
                pinned={activeInspection.id === selectedInspectionId}
                offsetX={INNER_X}
                offsetY={INNER_Y}
              />
            )}
          </div>
        </div>
      </div>
      <div data-canvas-controls className="pointer-events-none absolute bottom-3 right-3 top-3 z-20 flex flex-col items-end justify-between gap-2 lg:bottom-auto lg:flex-row lg:items-center lg:justify-start">
        <div className="pointer-events-auto order-2 flex items-center gap-1 rounded-sm bg-black/55 px-3 py-0.5 shadow-[0_1px_8px_rgba(0,0,0,0.22)] backdrop-blur-md lg:order-1 lg:py-1.5">
        {(['fit', '100', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`no-format min-h-8 px-1 text-xs lg:min-h-0 ${viewMode === mode ? 'text-white' : 'text-white/65'}`}
            aria-pressed={viewMode === mode}
            onClick={(event) => {
              event.stopPropagation();
              selectView(mode);
            }}
          >
            [{mode === '100' ? '100%' : mode}]
          </button>
        ))}
        <span className="status-signal min-w-12 px-1 text-center text-[10px] text-white/65" aria-label="Current zoom">
          {Math.round(scale * viewZoom * 100)}%
        </span>
        <button
          type="button"
          className="no-format min-h-8 px-1 text-xs text-white/65 lg:min-h-0"
          onClick={(event) => {
            event.stopPropagation();
            setViewMode('fit');
            onInspectionSelect?.(null);
            emitInspectionHover(null);
            applyRestView('fit');
          }}
        >
          {'<reset>'}
        </button>
        </div>
        {onToggleTools && (
          <button
            type="button"
            className="no-format pointer-events-auto order-1 min-h-9 px-1 text-xs text-white lg:order-2 lg:min-h-0"
            aria-label={toolsOpen ? 'Hide controls' : 'Open controls'}
            aria-pressed={toolsOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleTools();
            }}
          >
            {toolsOpen ? '<hide tools>' : '<tools>'}
          </button>
        )}
      </div>
    </div>
  );
}
