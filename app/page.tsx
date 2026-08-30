'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState, useCallback, useEffect, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
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
  DEFAULT_RENDER_VISIBILITY,
  type RenderVisibility,
} from './settings/renderVisibility';

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

export default function Home() {
  const [passageText, setPassageText] = useState<string>(littlePrince.text);
  const [passageHeader, setPassageHeader] = useState<string>(littlePrince.header);
  const [canvasOption, setCanvasOption] = useState<CanvasOption>(CANVAS_OPTIONS[0]);

  const [infoOpen, setInfoOpen] = useState<boolean>(true);
  const [canvasActivated, setCanvasActivated] = useState<boolean>(false);
  const [renderReady, setRenderReady] = useState<boolean>(false);
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
    DEFAULT_RENDER_VISIBILITY,
  );

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

  useEffect(() => () => {
    if (flushFrameRef.current !== null) {
      window.cancelAnimationFrame(flushFrameRef.current);
    }
  }, []);
  
  const exportCanvasHandler = useCallback(async () => {
    if (!renderReady) return;
    if (!isFixedCanvasOption(canvasOption)) {
      const live = liveCanvasRef.current;
      if (!live) return;
      live.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${safeFilename(passageHeader || 'textellation')}-live-view.png`;
        link.href = url;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
      return;
    }

    const fg = canvasRef.current;
    const bg = bgRef.current;
    if (!fg || !bg) return;

    const exportCanvas = document.createElement('canvas');
    const exportWidth = canvasOption.W + 2 * canvasOption.BG_SIDE_MARGIN;
    const exportHeight = canvasOption.H
      + canvasOption.BG_TOP_MARGIN
      + canvasOption.BG_BOTTOM_MARGIN;
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // 1) background first
    ctx.drawImage(bg, 0, 0, exportWidth, exportHeight);

    // 2) foreground at the SAME offsets you use in layout
    ctx.drawImage(
      fg,
      canvasOption.BG_SIDE_MARGIN,
      canvasOption.BG_TOP_MARGIN,
      canvasOption.W,
      canvasOption.H,
    );

    // Prefer toBlob for big images
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.download = `${safeFilename(passageHeader || 'textellation')}.png`;
      link.href = url;
      link.click();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }, [canvasOption, passageHeader, renderReady]);

  const canRender = useMemo(() => {
    return Boolean(passageText && passageHeader && canvasOption);
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
    setRenderReady(false);
  }, []);

  const recomposeCanvas = useCallback(() => {
    setCompositionRevision((revision) => revision + 1);
    setRegionRevisions({});
    setHoveredInspection(null);
    setSelectedInspection(null);
    setRenderReady(false);
  }, []);

  const toggleTools = useCallback(() => {
    setRailCollapsed((collapsed) => !collapsed);
  }, []);

  const handleCompositionPresetChange = useCallback((preset: CompositionPresetId) => {
    setCompositionPreset(preset);
    setHoveredInspection(null);
    setSelectedInspection(null);
    setRenderReady(false);
  }, []);

  const commitSave = useCallback((save: PendingSave) => {
    const { text, header, option, context } = save;
    applyingSaveRef.current = true;
    compositionBusyRef.current = true;
    setCompositionBusy(true);
    passageTextRef.current = text;
    passageHeaderRef.current = header;
    canvasOptionRef.current = option;
    setRenderReady(false);
    setPassageText(text);
    setPassageHeader(header);
    setCanvasOption(option);
    setHoveredInspection(null);
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
  }, []);

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
    if (busy) return;

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
  }, [commitSave]);

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
        <div ref={workspaceRef} className="relative flex h-[calc(100svh-6rem-4rem)] w-full flex-col gap-8 overflow-y-auto md:flex-row md:gap-0 md:overflow-visible">
            {/* left */}
            <div className="flex min-h-[50svh] min-w-0 flex-1 items-center justify-center md:min-h-0">
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
                  onInspectionHover={handleInspectionHover}
                  onInspectionSelect={handleInspectionSelect}
                  activeInspection={activeInspection}
                  selectedInspectionId={selectedInspection?.id ?? null}
                  toolsOpen={!railCollapsed}
                  onToggleTools={toggleTools}
                  regionRevisions={regionRevisions}
                  compositionRevision={compositionRevision}
                  compositionPreset={compositionPreset}
                  renderVisibility={renderVisibility}
                />
              ) : (
                <InfiniteLiveCanvas
                  passageText={passageText}
                  passageHeader={passageHeader}
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
                  renderVisibility={renderVisibility}
                />
              )
            )}
            </div>

            {!railCollapsed && (
              <div
                className="group relative hidden w-5 shrink-0 cursor-col-resize touch-none items-stretch justify-center md:flex"
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
              className="relative min-h-0 w-full shrink-0 overflow-visible md:w-[var(--rail-width)] md:overflow-hidden"
              style={{ '--rail-width': railCollapsed ? '0px' : `${railWidth}px` } as CSSProperties}
              aria-label="Textellation controls"
            >
            {!railCollapsed && (
              <div className="h-auto pr-1 pt-7 md:h-full md:overflow-y-auto">
            <TextEditModal
                onSave={handleSave}
                onDownload={exportCanvasHandler}
                downloadLabel={canvasOption.kind === 'infinite' ? 'download view' : 'download image'}
                downloadDisabled={!renderReady}
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
                onRenderVisibilityChange={setRenderVisibility}
            />
              </div>
            )}
            </aside>
        </div>
        </div>

        <InfoModal
          isOpen={infoOpen}
          closeModule={() => {
            setInfoOpen(false);
            setCanvasActivated(true);
            setRenderReady(false);
          }}
        />
    </div>
    );

}
