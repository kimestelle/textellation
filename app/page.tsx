'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState, useCallback, useEffect, useLayoutEffect, type CSSProperties, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import {
  CANVAS_OPTIONS,
  CanvasOption,
  isFixedCanvasOption,
} from './settings/canvasOptions';
import TextEditModal, { type SaveContext } from './components/textEditModal';
import InfoModal from './components/infoModal';
import { littlePrince } from './settings/examples';
import {
  sentenceCountForParagraph,
  type CanvasInspection,
} from './helpers/inspectionHelpers';
import { tokenizeAndBucket } from './helpers/posHelpers';
import type { CompositionPresetId } from './settings/compositionPresets';
import {
  PRESET_RENDER_VISIBILITY,
  type RenderVisibility,
} from './settings/renderVisibility';
import {
  DEFAULT_BURN_MODE,
  type BurnMode,
} from './settings/burnMode';

const DrawCanvas = dynamic(() => import('./DrawCanvas'), { ssr: false });
const InfiniteLiveCanvas = dynamic(() => import('./InfiniteLiveCanvas'), {
  ssr: false,
});

function safeFilename(s: string) {
  return s
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

type PendingSave = {
  text: string;
  header: string;
  option: CanvasOption;
  context?: SaveContext;
};

type EditorSessionSnapshot = {
  version: 1;
  activated: boolean;
  text: string;
  header: string;
  canvasOptionId: string;
  compositionPreset: CompositionPresetId;
  renderVisibility: RenderVisibility;
  burnMode: BurnMode;
};

const EDITOR_SESSION_KEY = 'textellation.editor-session.v1';
const VISIBILITY_KEYS: Array<keyof RenderVisibility> = [
  'grid',
  'particles',
  'ellipseSpokes',
  'ellipses',
  'ellipseLabels',
  'ellipseConnectors',
  'orderEdges',
  'punctuationEdges',
  'strongPosEdges',
  'weakPosEdges',
];

function readEditorSession(): EditorSessionSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(EDITOR_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorSessionSnapshot>;
    const optionExists = CANVAS_OPTIONS.some(
      (option) => option.id === parsed.canvasOptionId,
    );
    const presetExists = Boolean(
      parsed.compositionPreset && PRESET_RENDER_VISIBILITY[parsed.compositionPreset],
    );
    const visibility = parsed.renderVisibility;
    const visibilityIsValid = Boolean(
      visibility && VISIBILITY_KEYS.every((key) => typeof visibility[key] === 'boolean'),
    );
    if (
      parsed.version !== 1 ||
      parsed.activated !== true ||
      typeof parsed.text !== 'string' ||
      typeof parsed.header !== 'string' ||
      !optionExists ||
      !presetExists ||
      !visibilityIsValid
    ) {
      return null;
    }
    const burnMode: BurnMode = parsed.burnMode === 'light' ? 'light' : 'dark';
    return { ...parsed, burnMode } as EditorSessionSnapshot;
  } catch {
    return null;
  }
}

function writeEditorSession(snapshot: EditorSessionSnapshot) {
  try {
    window.sessionStorage.setItem(EDITOR_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable in strict/private browser modes. Rendering
    // remains fully functional; only crash recovery is skipped.
  }
}

export default function Home() {
  const [passageText, setPassageText] = useState<string>(littlePrince.text);
  const [passageHeader, setPassageHeader] = useState<string>(littlePrince.header);
  const [canvasOption, setCanvasOption] = useState<CanvasOption>(CANVAS_OPTIONS[0]);

  const [infoOpen, setInfoOpen] = useState<boolean>(true);
  const [canvasActivated, setCanvasActivated] = useState<boolean>(false);
  const [renderReady, setRenderReady] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<CanvasInspection | null>(null);
  const [selectedInspection, setSelectedInspection] = useState<CanvasInspection | null>(null);
  const [regionRevisions, setRegionRevisions] = useState<Record<number, number>>({});
  const [compositionRevision, setCompositionRevision] = useState(0);
  const [railWidth, setRailWidth] = useState(360);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [compositionPreset, setCompositionPreset] = useState<CompositionPresetId>('baseline');
  const [compositionBusy, setCompositionBusy] = useState(false);
  const [compositionQueued, setCompositionQueued] = useState(false);
  const [renderVisibility, setRenderVisibility] = useState<RenderVisibility>(
    PRESET_RENDER_VISIBILITY.baseline,
  );
  const [appliedRenderVisibility, setAppliedRenderVisibility] = useState<RenderVisibility>(
    PRESET_RENDER_VISIBILITY.baseline,
  );
  const [burnMode, setBurnMode] = useState<BurnMode>(DEFAULT_BURN_MODE);
  const [appliedBurnMode, setAppliedBurnMode] = useState<BurnMode>(DEFAULT_BURN_MODE);
  const [burnModeApplying, setBurnModeApplying] = useState(false);
  const [editorSessionRestored, setEditorSessionRestored] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const railResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const passageTextRef = useRef(passageText);
  const passageHeaderRef = useRef(passageHeader);
  const canvasOptionRef = useRef(canvasOption);
  const compositionBusyRef = useRef(false);
  const applyingSaveRef = useRef(false);
  const queuedSaveRef = useRef<PendingSave | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const specimenScrollFrameRef = useRef<number | null>(null);
  const exportBusyRef = useRef(false);
  const visibilityTimerRef = useRef<number | null>(null);
  const burnModeTimerRef = useRef<number | null>(null);
  const burnModePaintFramesRef = useRef<{ first: number | null; second: number | null }>({
    first: null,
    second: null,
  });
  const renderVisibilityRef = useRef(renderVisibility);
  const burnModeRef = useRef(burnMode);
  const editorSessionRef = useRef<EditorSessionSnapshot>({
    version: 1,
    activated: false,
    text: littlePrince.text,
    header: littlePrince.header,
    canvasOptionId: CANVAS_OPTIONS[0].id,
    compositionPreset: 'baseline',
    renderVisibility: { ...PRESET_RENDER_VISIBILITY.baseline },
    burnMode: DEFAULT_BURN_MODE,
  });

  const persistEditorSession = useCallback((patch: Partial<EditorSessionSnapshot>) => {
    const next = { ...editorSessionRef.current, ...patch };
    editorSessionRef.current = next;
    if (next.activated) writeEditorSession(next);
  }, []);

  useEffect(() => {
    const restored = readEditorSession();
    if (!restored) return;
    const restoredOption = CANVAS_OPTIONS.find(
      (option) => option.id === restored.canvasOptionId,
    );
    if (!restoredOption) return;

    const restoreFrame = window.requestAnimationFrame(() => {
      editorSessionRef.current = restored;
      passageTextRef.current = restored.text;
      passageHeaderRef.current = restored.header;
      canvasOptionRef.current = restoredOption;
      renderVisibilityRef.current = restored.renderVisibility;
      burnModeRef.current = restored.burnMode;
      setPassageText(restored.text);
      setPassageHeader(restored.header);
      setCanvasOption(restoredOption);
      setCompositionPreset(restored.compositionPreset);
      setRenderVisibility(restored.renderVisibility);
      setAppliedRenderVisibility(restored.renderVisibility);
      setBurnMode(restored.burnMode);
      setAppliedBurnMode(restored.burnMode);
      setEditorSessionRestored(true);
      setInfoOpen(false);
      setCanvasActivated(true);
      setRenderReady(false);
    });
    return () => window.cancelAnimationFrame(restoreFrame);
  }, []);

  useEffect(() => () => {
    if (flushFrameRef.current !== null) {
      window.cancelAnimationFrame(flushFrameRef.current);
    }
    if (specimenScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(specimenScrollFrameRef.current);
    }
    if (visibilityTimerRef.current !== null) {
      window.clearTimeout(visibilityTimerRef.current);
    }
    if (burnModeTimerRef.current !== null) {
      window.clearTimeout(burnModeTimerRef.current);
    }
    const burnFrames = burnModePaintFramesRef.current;
    if (burnFrames.first !== null) window.cancelAnimationFrame(burnFrames.first);
    if (burnFrames.second !== null) window.cancelAnimationFrame(burnFrames.second);
  }, []);
  
  const exportCanvasHandler = useCallback(async () => {
    if (!renderReady || burnModeApplying || exportBusyRef.current) return;
    exportBusyRef.current = true;
    const releaseExport = () => {
      exportBusyRef.current = false;
    };
    if (!isFixedCanvasOption(canvasOption)) {
      const live = liveCanvasRef.current;
      if (!live) {
        releaseExport();
        return;
      }
      try {
        live.toBlob((blob) => {
          releaseExport();
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `${safeFilename(passageHeader || 'textellation')}-live-view.png`;
          link.href = url;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      } catch {
        releaseExport();
      }
      return;
    }

    const fg = canvasRef.current;
    const bg = bgRef.current;
    if (!fg || !bg) {
      releaseExport();
      return;
    }

    const exportCanvas = document.createElement('canvas');
    const logicalWidth = canvasOption.W + 2 * canvasOption.BG_SIDE_MARGIN;
    const logicalHeight = canvasOption.H
      + canvasOption.BG_TOP_MARGIN
      + canvasOption.BG_BOTTOM_MARGIN;
    // Mobile previews are intentionally downsampled. Composite at their native
    // backing resolution instead of upscaling into an otherwise empty 27 MB
    // poster surface. Desktop sources remain full-resolution.
    const scaleX = bg.width / logicalWidth;
    const scaleY = bg.height / logicalHeight;
    exportCanvas.width = bg.width;
    exportCanvas.height = bg.height;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      exportCanvas.width = 1;
      exportCanvas.height = 1;
      releaseExport();
      return;
    }

    // 1) background first
    ctx.drawImage(bg, 0, 0);

    // 2) foreground at the SAME offsets you use in layout
    ctx.drawImage(
      fg,
      canvasOption.BG_SIDE_MARGIN * scaleX,
      canvasOption.BG_TOP_MARGIN * scaleY,
      canvasOption.W * scaleX,
      canvasOption.H * scaleY,
    );

    // Prefer toBlob for big images
    try {
      exportCanvas.toBlob((blob) => {
        exportCanvas.width = 1;
        exportCanvas.height = 1;
        releaseExport();
        if (!blob) return;
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.download = `${safeFilename(passageHeader || 'textellation')}.png`;
        link.href = url;
        link.click();

        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    } catch {
      exportCanvas.width = 1;
      exportCanvas.height = 1;
      releaseExport();
    }
  }, [burnModeApplying, canvasOption, passageHeader, renderReady]);

  const canRender = useMemo(() => {
    return Boolean(passageText.trim() && passageHeader.trim() && canvasOption);
  }, [passageText, passageHeader, canvasOption]);

  const activeInspection = hoveredInspection ?? selectedInspection;

  const handleInspectionHover = useCallback((inspection: CanvasInspection | null) => {
    setHoveredInspection(inspection);
  }, []);

  const handleInspectionSelect = useCallback((inspection: CanvasInspection | null) => {
    setSelectedInspection(inspection);
  }, []);

  const recomposeRegion = useCallback((paragraphIndex: number) => {
    setRegionRevisions((current) => ({
      ...current,
      [paragraphIndex]: (current[paragraphIndex] ?? 0) + 1,
    }));
    setHoveredInspection(null);
    setRenderError(null);
    setRenderReady(false);
  }, []);

  const recomposeCanvas = useCallback(() => {
    setCompositionRevision((revision) => revision + 1);
    setRegionRevisions({});
    setHoveredInspection(null);
    setSelectedInspection(null);
    setRenderError(null);
    setRenderReady(false);
  }, []);

  const toggleTools = useCallback(() => {
    setRailCollapsed((collapsed) => !collapsed);
  }, []);

  const handleCompositionPresetChange = useCallback((preset: CompositionPresetId) => {
    if (preset === compositionPreset) return;
    if (visibilityTimerRef.current !== null) {
      window.clearTimeout(visibilityTimerRef.current);
      visibilityTimerRef.current = null;
    }
    const presetVisibility = { ...PRESET_RENDER_VISIBILITY[preset] };
    renderVisibilityRef.current = presetVisibility;
    setRenderVisibility(presetVisibility);
    setAppliedRenderVisibility(presetVisibility);
    persistEditorSession({
      compositionPreset: preset,
      renderVisibility: presetVisibility,
    });
    setCompositionPreset(preset);
    setHoveredInspection(null);
    setSelectedInspection(null);
    setRenderError(null);
    setRenderReady(false);
  }, [compositionPreset, persistEditorSession]);

  const handleRenderVisibilityChange = useCallback((update: SetStateAction<RenderVisibility>) => {
    const next = typeof update === 'function'
      ? update(renderVisibilityRef.current)
      : update;
    renderVisibilityRef.current = next;
    setRenderVisibility(next);
    persistEditorSession({ renderVisibility: next });
    if (visibilityTimerRef.current !== null) {
      window.clearTimeout(visibilityTimerRef.current);
      visibilityTimerRef.current = null;
    }
    if (!window.matchMedia('(max-width: 1023px), (pointer: coarse)').matches) {
      setAppliedRenderVisibility(next);
      return;
    }
    // Knob labels respond immediately; the expensive canvas paint is trailing
    // and latest-only so a run of taps cannot queue multiple mobile redraws.
    visibilityTimerRef.current = window.setTimeout(() => {
      visibilityTimerRef.current = null;
      setAppliedRenderVisibility(renderVisibilityRef.current);
    }, 220);
  }, [persistEditorSession]);

  const releaseBurnModeExport = useCallback(() => {
    const frames = burnModePaintFramesRef.current;
    if (frames.first !== null) window.cancelAnimationFrame(frames.first);
    if (frames.second !== null) window.cancelAnimationFrame(frames.second);
    frames.first = window.requestAnimationFrame(() => {
      frames.first = null;
      frames.second = window.requestAnimationFrame(() => {
        frames.second = null;
        setBurnModeApplying(false);
      });
    });
  }, []);

  const handleBurnModeChange = useCallback((next: BurnMode) => {
    const pendingFrames = burnModePaintFramesRef.current;
    if (pendingFrames.first !== null) {
      window.cancelAnimationFrame(pendingFrames.first);
      pendingFrames.first = null;
    }
    if (pendingFrames.second !== null) {
      window.cancelAnimationFrame(pendingFrames.second);
      pendingFrames.second = null;
    }
    burnModeRef.current = next;
    setBurnMode(next);
    setBurnModeApplying(true);
    persistEditorSession({ burnMode: next });
    if (burnModeTimerRef.current !== null) {
      window.clearTimeout(burnModeTimerRef.current);
      burnModeTimerRef.current = null;
    }
    if (!window.matchMedia('(max-width: 1023px), (pointer: coarse)').matches) {
      setAppliedBurnMode(next);
      releaseBurnModeExport();
      return;
    }
    burnModeTimerRef.current = window.setTimeout(() => {
      burnModeTimerRef.current = null;
      setAppliedBurnMode(burnModeRef.current);
      releaseBurnModeExport();
    }, 220);
  }, [persistEditorSession, releaseBurnModeExport]);

  const commitSave = useCallback((save: PendingSave) => {
    const { text, header, option, context } = save;
    const formatChanged = option.id !== canvasOptionRef.current.id;
    const hasRenderableSource = Boolean(text.trim() && header.trim());
    applyingSaveRef.current = hasRenderableSource;
    compositionBusyRef.current = hasRenderableSource;
    setCompositionBusy(hasRenderableSource);
    passageTextRef.current = text;
    passageHeaderRef.current = header;
    canvasOptionRef.current = option;
    setRenderError(null);
    setRenderReady(false);
    setPassageText(text);
    setPassageHeader(header);
    setCanvasOption(option);
    persistEditorSession({
      text,
      header,
      canvasOptionId: option.id,
    });
    setHoveredInspection(null);
    if (!hasRenderableSource) {
      queuedSaveRef.current = null;
      setCompositionQueued(false);
      setSelectedInspection(null);
      setRegionRevisions({});
      setCompositionRevision(0);
      return;
    }
    if (formatChanged && window.matchMedia('(max-width: 1023px)').matches) {
      if (specimenScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(specimenScrollFrameRef.current);
      }
      specimenScrollFrameRef.current = window.requestAnimationFrame(() => {
        specimenScrollFrameRef.current = window.requestAnimationFrame(() => {
          specimenScrollFrameRef.current = null;
          workspaceRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    }
    if (context?.kind !== 'region-edit') {
      setSelectedInspection(null);
      setRegionRevisions({});
      setCompositionRevision(0);
      return;
    }

    const sourceParagraph = context.editedParagraph;
    const sentences = sourceParagraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [sourceParagraph];
    const nodeCount = sentences.reduce(
      (total, sentence) => total + tokenizeAndBucket(sentence).tokens.length,
      0,
    );
    setSelectedInspection((current) => current?.kind === 'region'
      ? {
          ...current,
          sourceParagraph,
          sentenceCount: sentenceCountForParagraph(sourceParagraph),
          nodeCount,
        }
      : current);
  }, [persistEditorSession]);

  const flushQueuedSave = useCallback(() => {
    if (compositionBusyRef.current || applyingSaveRef.current) return;
    const queued = queuedSaveRef.current;
    if (!queued) return;
    queuedSaveRef.current = null;
    setCompositionQueued(false);
    commitSave(queued);
  }, [commitSave]);

  const handleBuildStateChange = useCallback((busy: boolean) => {
    compositionBusyRef.current = busy;
    setCompositionBusy(busy);
    if (busy) {
      setRenderError(null);
      return;
    }

    applyingSaveRef.current = false;
    if (queuedSaveRef.current) setRenderReady(false);
    if (flushFrameRef.current !== null) {
      window.cancelAnimationFrame(flushFrameRef.current);
    }
    // Cleanup from an old renderer can report idle immediately before the new
    // renderer reports busy. Waiting one frame prevents two builds from being
    // admitted during that handoff.
    flushFrameRef.current = window.requestAnimationFrame(() => {
      flushFrameRef.current = null;
      if (!compositionBusyRef.current) flushQueuedSave();
    });
  }, [flushQueuedSave]);

  const handleSave = useCallback((
    text: string,
    header: string,
    option: CanvasOption,
    context?: SaveContext,
  ) => {
    const textChanged = text !== passageTextRef.current;
    const formatChanged = option.id !== canvasOptionRef.current.id;
    const headerChanged = header !== passageHeaderRef.current;

    // The title belongs to the paper layer. Repaint it immediately without
    // invalidating or rebuilding the constellation.
    if (!textChanged && !formatChanged && context?.kind !== 'region-edit') {
      if (queuedSaveRef.current) {
        queuedSaveRef.current = null;
        setCompositionQueued(false);
      }
      if (headerChanged) {
        passageHeaderRef.current = header;
        setPassageHeader(header);
        persistEditorSession({ header });
      }
      return;
    }

    const pending = { text, header, option, context } satisfies PendingSave;
    if (compositionBusyRef.current || applyingSaveRef.current) {
      // One pending slot: every new edit replaces the stale queued snapshot.
      queuedSaveRef.current = pending;
      setCompositionQueued(true);
      return;
    }
    commitSave(pending);
  }, [commitSave, persistEditorSession]);

  const startRailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    railResizeRef.current = { startX: event.clientX, startWidth: railWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [railWidth]);

  const continueRailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = railResizeRef.current;
    const workspace = workspaceRef.current;
    if (!drag || !workspace) return;
    const maxWidth = Math.min(480, workspace.getBoundingClientRect().width * 0.42);
    setRailWidth(Math.round(Math.min(maxWidth, Math.max(280, drag.startWidth + drag.startX - event.clientX))));
  }, []);

  const endRailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    railResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const clampRail = () => {
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      const maxWidth = Math.min(480, workspace.getBoundingClientRect().width * 0.42);
      setRailWidth((current) => Math.round(Math.min(maxWidth, Math.max(280, current))));
    };
    clampRail();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(clampRail);
    observer?.observe(workspace);
    window.addEventListener('resize', clampRail);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', clampRail);
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-neutral-900">
        {/* top bar */}
        <div className="fixed top-0 left-0 z-50 w-full px-5 md:px-24 pt-6 flex justify-between items-start">
        <h2
            className="flex flex-col items-start text-left"
            onClick={() => setInfoOpen(true)}
        >
            textellation_.*&#x2726;
            <span className="hidden md:block text-neutral-400">
            make typographic constellations
            </span>
        </h2>
        </div>

        <div className="w-full min-h-[100svh] px-5 md:px-24 pt-24 pb-16">
        <div ref={workspaceRef} data-workspace className="relative flex h-[calc(100svh-6rem-4rem)] w-full flex-col gap-8 overflow-y-auto lg:flex-row lg:gap-0 lg:overflow-visible">
            {/* left */}
            <div className="flex min-h-[50svh] min-w-0 flex-1 items-center justify-center lg:min-h-0">
            {canvasActivated && canRender && (
              isFixedCanvasOption(canvasOption) ? (
                <DrawCanvas
                  passageText={passageText}
                  passageHeader={passageHeader}
                  canvasOption={canvasOption}
                  canvasRef={canvasRef}
                  bgRef={bgRef}
                  onReadyChange={setRenderReady}
                  onBuildStateChange={handleBuildStateChange}
                  onRenderError={setRenderError}
                  onInspectionHover={handleInspectionHover}
                  onInspectionSelect={handleInspectionSelect}
                  activeInspection={activeInspection}
                  selectedInspectionId={selectedInspection?.id ?? null}
                  toolsOpen={!railCollapsed}
                  onToggleTools={toggleTools}
                  regionRevisions={regionRevisions}
                  compositionRevision={compositionRevision}
                  compositionPreset={compositionPreset}
                  renderVisibility={appliedRenderVisibility}
                  burnMode={appliedBurnMode}
                />
              ) : (
                <InfiniteLiveCanvas
                  passageText={passageText}
                  canvasOption={canvasOption}
                  canvasRef={liveCanvasRef}
                  onReadyChange={setRenderReady}
                  onBuildStateChange={handleBuildStateChange}
                  onInspectionHover={handleInspectionHover}
                  onInspectionSelect={handleInspectionSelect}
                  activeInspection={activeInspection}
                  selectedInspectionId={selectedInspection?.id ?? null}
                  toolsOpen={!railCollapsed}
                  onToggleTools={toggleTools}
                  regionRevisions={regionRevisions}
                  compositionRevision={compositionRevision}
                  compositionPreset={compositionPreset}
                  renderVisibility={appliedRenderVisibility}
                  burnMode={appliedBurnMode}
                />
              )
            )}
            </div>

            {!railCollapsed && (
              <div
                className="group relative hidden w-5 shrink-0 cursor-col-resize touch-none items-stretch justify-center lg:flex"
                role="separator"
                aria-label="Resize controls rail"
                aria-orientation="vertical"
                onPointerDown={startRailResize}
                onPointerMove={continueRailResize}
                onPointerUp={endRailResize}
                onPointerCancel={endRailResize}
              >
                <span className="my-2 w-px bg-white/15 transition-colors group-hover:bg-white/45" />
              </div>
            )}

            {/* right */}
            <aside
              className="relative min-h-0 w-full shrink-0 overflow-visible lg:w-[var(--rail-width)] lg:overflow-hidden"
              style={{ '--rail-width': railCollapsed ? '0px' : `${railWidth}px` } as CSSProperties}
              aria-label="Textellation controls"
            >
              <div className={`${railCollapsed ? 'hidden' : 'block'} h-auto pr-1 pt-7 lg:h-full lg:overflow-y-auto`}>
            <TextEditModal
                key={editorSessionRestored ? 'restored-editor' : 'editor'}
                onSave={handleSave}
                onDownload={exportCanvasHandler}
                downloadLabel={canvasOption.kind === 'infinite' ? 'download view' : 'download image'}
                downloadDisabled={!renderReady || burnModeApplying}
                renderError={renderError}
                renderedText={passageText}
                renderedHeader={passageHeader}
                renderedCanvasOption={canvasOption}
                selectedInspection={selectedInspection}
                onClearInspection={() => {
                  setHoveredInspection(null);
                  setSelectedInspection(null);
                }}
                onRecomposeRegion={recomposeRegion}
                onRecompose={recomposeCanvas}
                compositionPreset={compositionPreset}
                compositionBusy={compositionBusy || compositionQueued}
                compositionQueued={compositionQueued}
                onCompositionPresetChange={handleCompositionPresetChange}
                renderVisibility={renderVisibility}
                onRenderVisibilityChange={handleRenderVisibilityChange}
                burnMode={burnMode}
                onBurnModeChange={handleBurnModeChange}
            />
              </div>
            </aside>
        </div>
        </div>

        <InfoModal
          isOpen={infoOpen}
          closeModule={() => {
            setInfoOpen(false);
            setCanvasActivated(true);
            setRenderReady(false);
            persistEditorSession({ activated: true });
          }}
        />
    </div>
    );

}
