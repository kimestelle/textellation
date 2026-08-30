'use client';

import { useEffect, useRef, useState } from 'react';
import { littlePrince, lookingGlass } from '../settings/examples';
import { CANVAS_OPTIONS, CanvasOption } from '../settings/canvasOptions';
import {
  boundTextForCanvas,
  countWordsAndParagraphs,
} from '../helpers/textFit';
import CanvasOptionPreview from './CanvasOptionPreview';
import {
  splitPassageParagraphs,
  type CanvasInspection,
} from '../helpers/inspectionHelpers';
import {
  COMPOSITION_PRESET_CHOICES,
  COMPOSITION_PRESETS,
  type CompositionPresetId,
} from '../settings/compositionPresets';
import {
  DEFAULT_RENDER_VISIBILITY,
  RENDER_VISIBILITY_GROUPS,
  type RenderVisibility,
} from '../settings/renderVisibility';

export type SaveContext =
  | { kind: 'automatic' }
  | {
      kind: 'region-edit';
      editedRegionIndex: number;
      editedParagraph: string;
    };

type TextEditModalProps = {
  onSave: (
    text: string,
    header: string,
    canvasOption: CanvasOption,
    context?: SaveContext,
  ) => void;
  onDownload?: () => void;
  downloadLabel?: string;
  downloadDisabled?: boolean;
  renderedText: string;
  renderedHeader: string;
  renderedCanvasOption: CanvasOption;
  selectedInspection?: CanvasInspection | null;
  onClearInspection?: () => void;
  onRecomposeRegion?: (paragraphIndex: number) => void;
  onRecompose?: () => void;
  compositionPreset?: CompositionPresetId;
  compositionBusy?: boolean;
  onCompositionPresetChange?: (preset: CompositionPresetId) => void;
  renderVisibility?: RenderVisibility;
  onRenderVisibilityChange?: (visibility: RenderVisibility) => void;
};

function draftSignature(text: string, header: string, option: CanvasOption) {
  return `${option.id}\u001f${header}\u001f${text}`;
}

function countLabel(text: string, option: CanvasOption) {
  const count = countWordsAndParagraphs(text, option);
  return `${count.words} word${count.words === 1 ? '' : 's'} in ${count.paragraphs} / ${option.maxParas} region${count.paragraphs === 1 ? '' : 's'}`;
}

function pixelSizeLabel(option: CanvasOption) {
  const dimensions = `${option.W} × ${option.H} px`;
  return option.kind === 'infinite'
    ? `${dimensions} initial viewport`
    : dimensions;
}

export default function TextEditModal({
  onSave,
  onDownload,
  downloadLabel = 'download image',
  downloadDisabled = false,
  renderedText,
  renderedHeader,
  renderedCanvasOption,
  selectedInspection,
  onClearInspection,
  onRecomposeRegion,
  onRecompose,
  compositionPreset = 'baseline',
  compositionBusy = false,
  onCompositionPresetChange,
  renderVisibility = DEFAULT_RENDER_VISIBILITY,
  onRenderVisibilityChange,
}: TextEditModalProps) {
  const [text, setText] = useState<string>(littlePrince.text);
  const [header, setHeader] = useState<string>(littlePrince.header);
  const [canvasSetting, setCanvasSetting] = useState<CanvasOption>(CANVAS_OPTIONS[0]);
  const [note, setNote] = useState<string>('');
  const [hoveredOption, setHoveredOption] = useState<CanvasOption | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [regionEdit, setRegionEdit] = useState<{ id: string; value: string } | null>(null);
  const [pendingPreset, setPendingPreset] = useState<CompositionPresetId | null>(null);
  const autoVersionRef = useRef(0);
  const lastSubmittedRef = useRef(
    draftSignature(littlePrince.text, littlePrince.header, CANVAS_OPTIONS[0]),
  );
  const shownOption = hoveredOption ?? canvasSetting;
  const selectedRegion = selectedInspection?.kind === 'region'
    ? selectedInspection
    : null;
  const regionDraft = selectedRegion
    ? regionEdit?.id === selectedRegion.id
      ? regionEdit.value
      : selectedRegion.sourceParagraph
    : '';

  useEffect(() => {
    if (!pendingPreset || compositionBusy || !onCompositionPresetChange) return;
    if (pendingPreset === compositionPreset) {
      setPendingPreset(null);
      return;
    }
    const timer = window.setTimeout(() => {
      onCompositionPresetChange(pendingPreset);
      setPendingPreset(null);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [compositionBusy, compositionPreset, onCompositionPresetChange, pendingPreset]);

  function handleExampleClick(example: { text: string; header: string }) {
    setText(example.text);
    setHeader(example.header);
    setNote('');
  }

  useEffect(() => {
    const signature = draftSignature(text, header, canvasSetting);
    if (signature === lastSubmittedRef.current) return;
    const version = ++autoVersionRef.current;
    const timer = window.setTimeout(async () => {
      const trimmedHeader = header.trim();
      if (!text.trim() || !trimmedHeader) {
        if (version !== autoVersionRef.current) return;
        lastSubmittedRef.current = signature;
        setIsPreparing(false);
        setNote('Add a header and some text to render the canvas.');
        onSave(text, trimmedHeader, canvasSetting, { kind: 'automatic' });
        return;
      }

      setIsPreparing(true);
      try {
        const result = await boundTextForCanvas(text, canvasSetting);
        if (version !== autoVersionRef.current) return;
        const parts: string[] = [];
        if (result.removedParas > 0) {
          parts.push(`Removed ${result.removedParas} extra region${result.removedParas === 1 ? '' : 's'} (max ${canvasSetting.maxParas}).`);
        }
        if (result.trimmedWords > 0) {
          parts.push(`Trimmed ${result.trimmedWords} word${result.trimmedWords === 1 ? '' : 's'} to keep this canvas responsive.`);
        }
        if (result.clippedTokens > 0) {
          parts.push(`Shortened ${result.clippedTokens} unusually long token${result.clippedTokens === 1 ? '' : 's'}.`);
        }
        if (!result.ok) parts.push('This passage could not fit at a readable size.');
        setNote(parts.join(' '));
        if (!result.ok) return;
        lastSubmittedRef.current = signature;
        onSave(result.boundedText, trimmedHeader, canvasSetting, { kind: 'automatic' });
      } catch {
        if (version !== autoVersionRef.current) return;
        setNote('This passage could not be prepared. Try a shorter one.');
      } finally {
        if (version === autoVersionRef.current) setIsPreparing(false);
      }
    }, 420);

    return () => window.clearTimeout(timer);
  }, [canvasSetting, header, onSave, text]);

  async function handleRegionApply() {
    if (!selectedRegion || isPreparing) return;
    const nextParagraph = regionDraft.replace(/\s+/g, ' ').trim();
    if (!nextParagraph) {
      setNote('A selected region needs at least one word.');
      return;
    }
    const paragraphs = splitPassageParagraphs(renderedText);
    if (!paragraphs[selectedRegion.paragraphIndex]) {
      setNote('That region is no longer present. Select it again on the canvas.');
      return;
    }
    paragraphs[selectedRegion.paragraphIndex] = nextParagraph;
    const nextText = paragraphs.join('\n\n');

    setIsPreparing(true);
    let result: Awaited<ReturnType<typeof boundTextForCanvas>>;
    try {
      result = await boundTextForCanvas(nextText, renderedCanvasOption);
    } catch {
      setNote('That region could not be prepared. Try a shorter paragraph.');
      setIsPreparing(false);
      return;
    }
    setIsPreparing(false);
    if (!result.ok) {
      setNote('That region cannot fit at a readable size.');
      return;
    }

    const boundedParagraph = splitPassageParagraphs(result.boundedText)[selectedRegion.paragraphIndex];
    if (!boundedParagraph) {
      setNote('That edit removed the selected region. Try a shorter paragraph.');
      return;
    }
    setText(result.boundedText);
    setHeader(renderedHeader);
    setCanvasSetting(renderedCanvasOption);
    setRegionEdit({ id: selectedRegion.id, value: boundedParagraph });
    setNote('');
    lastSubmittedRef.current = draftSignature(
      result.boundedText,
      renderedHeader,
      renderedCanvasOption,
    );
    onSave(result.boundedText, renderedHeader, renderedCanvasOption, {
      kind: 'region-edit',
      editedRegionIndex: selectedRegion.paragraphIndex,
      editedParagraph: boundedParagraph,
    });
  }

  return (
    <div className="relative flex h-fit w-full flex-col items-start gap-7">
      <section className="flex w-full flex-col gap-2" aria-labelledby="rail-text-heading">
        <div className="flex w-full flex-row items-baseline">
          <h3 id="rail-text-heading">1 text</h3>
          <span className="mb-2 ml-2 flex-grow border-b border-dashed border-neutral-500" />
        </div>
        <input
          type="text"
          aria-label="Header"
          placeholder="Header"
          value={header}
          onChange={(event) => setHeader(event.target.value)}
          className="w-full bg-transparent outline-none"
        />
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setNote('');
          }}
          aria-label="Passage"
          placeholder="Paste or type your text…"
          className="min-h-32 max-h-[32svh] w-full resize-y overflow-y-auto outline-none"
        />
        {note ? (
          <div role="status" className="status-signal mb-3 text-[11px] leading-snug" style={{ color: 'rgba(255,120,120,0.78)' }}>
            {note}
          </div>
        ) : (
          <div className="status-signal text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {countLabel(text, canvasSetting)} · max {canvasSetting.maxWords} words
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="no-format"
            onClick={() => {
              setText('');
              setHeader('');
              setNote('');
            }}
          >
            {'<clear>'}
          </button>
          <div className="flex flex-row flex-wrap gap-2">
            <button type="button" className="no-format text-neutral-500 text-start" onClick={() => handleExampleClick(lookingGlass)}>
              {'[Through the Looking-Glass]'}
            </button>
            <button type="button" className="no-format text-neutral-500 text-start" onClick={() => handleExampleClick(littlePrince)}>
              {'[The Little Prince]'}
            </button>
          </div>
        </div>
      </section>

      <section className="flex w-full flex-col gap-3" aria-labelledby="rail-composition-heading">
        <div className="flex w-full flex-row items-baseline">
          <h3 id="rail-composition-heading">2 composition</h3>
          <span className="mb-2 ml-2 flex-grow border-b border-dashed border-neutral-500" />
        </div>
        <div className="flex w-full flex-col gap-1" role="group" aria-label="Canvas format">
          {CANVAS_OPTIONS.map((option) => {
            const active = option.id === canvasSetting.id;
            return (
              <button
                type="button"
                key={option.id}
                aria-pressed={active}
                className="canvas-option no-format group flex w-full items-center gap-3 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-white/60"
                onClick={() => {
                  setCanvasSetting(option);
                  setNote('');
                }}
                onMouseEnter={() => setHoveredOption(option)}
                onMouseLeave={() => setHoveredOption(null)}
                onFocus={() => setHoveredOption(option)}
                onBlur={() => setHoveredOption(null)}
              >
                <CanvasOptionPreview option={option} active={active} size={48} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <span className={active ? 'leading-tight text-white' : 'leading-tight text-neutral-400'}>
                    [{option.name}]
                  </span>
                  <span className={`status-signal text-[10px] leading-none ${active ? 'text-white/70' : 'text-white/35'}`}>
                    {pixelSizeLabel(option)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="status-signal text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>
          {shownOption.description}
        </div>
        <button
          type="button"
          className="no-format self-start text-neutral-200 disabled:cursor-not-allowed disabled:opacity-35"
          onClick={onRecompose}
          disabled={isPreparing}
        >
          {'<recompose>'}
        </button>

        {selectedRegion && (
          <div className="mt-2 flex w-full flex-col gap-2 border-t border-dashed border-white/20 pt-3" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="selected-region-text" className="status-signal text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                edit paragraph {selectedRegion.paragraphIndex + 1}
              </label>
              <button type="button" className="no-format text-xs text-neutral-500" onClick={onClearInspection}>{'<clear>'}</button>
            </div>
            <textarea
              id="selected-region-text"
              value={regionDraft}
              onChange={(event) => {
                setRegionEdit({ id: selectedRegion.id, value: event.target.value });
                setNote('');
              }}
              className="min-h-24 w-full resize-y outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="no-format" onClick={() => void handleRegionApply()} disabled={isPreparing}>
                {isPreparing ? '<preparing…>' : '<apply region>'}
              </button>
              <button type="button" className="no-format text-neutral-400" onClick={() => onRecomposeRegion?.(selectedRegion.paragraphIndex)}>
                {'<recompose region>'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="flex w-full flex-col gap-3 pb-2" aria-labelledby="rail-output-heading">
        <div className="flex w-full flex-row items-baseline">
          <h3 id="rail-output-heading">3 output</h3>
          <span className="mb-2 ml-2 flex-grow border-b border-dashed border-neutral-500" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="status-signal text-[11px] text-neutral-500" role="status">
            {isPreparing ? 'updating canvas…' : downloadDisabled ? 'canvas settling…' : 'canvas ready'}
          </span>
          <button
            type="button"
            className="no-format shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
            onClick={onDownload}
            disabled={downloadDisabled}
          >
            {`<${downloadLabel}>`}
          </button>
        </div>
      </section>

      <section className="flex w-full flex-col gap-3 pb-8" aria-labelledby="rail-knobs-heading">
        <div className="flex w-full flex-row items-baseline">
          <h3 id="rail-knobs-heading">more knobs</h3>
          <span className="mb-2 ml-2 flex-grow border-b border-dashed border-neutral-500" />
        </div>
        <div className="flex w-full flex-col gap-2" role="group" aria-label="Composition preset">
          {COMPOSITION_PRESET_CHOICES.map((preset) => {
            const shownPreset = pendingPreset ?? compositionPreset;
            const active = preset.id === shownPreset;
            return (
              <button
                key={preset.id}
                type="button"
                className="no-format flex w-full flex-col items-start text-left"
                aria-pressed={active}
                onClick={() => setPendingPreset(preset.id)}
              >
                <span className={active ? 'text-white' : 'text-neutral-400'}>
                  [{preset.label}]
                </span>
                <span className="status-signal text-[10px] leading-snug text-white/45">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="status-signal text-[10px] leading-snug text-white/45" role="status">
            {pendingPreset
              ? compositionBusy
                ? `${COMPOSITION_PRESETS[pendingPreset].label.toLowerCase()} queued · waits for current composition`
                : `${COMPOSITION_PRESETS[pendingPreset].label.toLowerCase()} queued · latest choice wins`
              : compositionBusy
                ? 'composition settling · controls gated'
                : COMPOSITION_PRESETS[compositionPreset].description}
          </span>
          <button
            type="button"
            className="no-format shrink-0 text-neutral-300"
            onClick={() => setPendingPreset('baseline')}
          >
            {'<reset>'}
          </button>
        </div>
        <div className="flex w-full flex-col gap-2 border-t border-dashed border-white/15 pt-3">
          <span className="status-signal text-[10px] text-white/45">
            visibility · drawing only
          </span>
          {RENDER_VISIBILITY_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <span className="status-signal text-[9px] uppercase tracking-[0.08em] text-white/30">
                {group.label}
              </span>
              <div
                className="flex flex-wrap gap-x-3 gap-y-1"
                role="group"
                aria-label={`${group.label} visibility`}
              >
                {group.choices.map((choice) => {
                  const visible = renderVisibility[choice.id];
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      className={`no-format text-left ${visible ? 'text-white' : 'text-white/30'}`}
                      aria-pressed={visible}
                      onClick={() => onRenderVisibilityChange?.({
                        ...renderVisibility,
                        [choice.id]: !visible,
                      })}
                    >
                      [{choice.label}]
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="no-format self-end text-neutral-300"
            onClick={() => onRenderVisibilityChange?.({ ...DEFAULT_RENDER_VISIBILITY })}
          >
            {'<show all>'}
          </button>
        </div>
      </section>
    </div>
  );
}
