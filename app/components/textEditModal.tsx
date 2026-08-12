'use client';

import { useState } from 'react';
import { littlePrince, lookingGlass } from '../settings/examples';
import { CANVAS_OPTIONS, CanvasOption } from '../settings/canvasOptions';
import { generateStarPattern } from '../helpers/drawHelpers';
import {
  boundTextForCanvas,
  countWordsAndParagraphs,
} from '../helpers/textFit';
import CanvasOptionPreview from './CanvasOptionPreview';

type TextEditModalProps = {
  onSave: (text: string, header: string, canvasOption: CanvasOption) => void;
  onDownload?: () => void;
  downloadLabel?: string;
  downloadDisabled?: boolean;
};

function countLabel(text: string, option: CanvasOption) {
  const count = countWordsAndParagraphs(text, option);
  return `${count.words} word${count.words === 1 ? '' : 's'} in ${count.paragraphs} / ${option.maxParas} region${count.paragraphs === 1 ? '' : 's'}`;
}

export default function TextEditModal({
  onSave,
  onDownload,
  downloadLabel = 'download image',
  downloadDisabled = false,
}: TextEditModalProps) {
  const [text, setText] = useState<string>(littlePrince.text);
  const [header, setHeader] = useState<string>(littlePrince.header);
  const [canvasSetting, setCanvasSetting] = useState<CanvasOption>(CANVAS_OPTIONS[0]);
  const [note, setNote] = useState<string>('');
  const [hoveredOption, setHoveredOption] = useState<CanvasOption | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const shownOption = hoveredOption ?? canvasSetting;

  function handleExampleClick(example: { text: string; header: string }) {
    setText(example.text);
    setHeader(example.header);
    setNote('');
  }

  async function handleSave() {
    if (isPreparing) return;
    if (!text.trim() || !header.trim()) {
      setNote('please fill the header and text!');
      return;
    }

    setIsPreparing(true);
    let result: Awaited<ReturnType<typeof boundTextForCanvas>>;
    try {
      result = await boundTextForCanvas(text, canvasSetting);
    } catch {
      setNote('This passage could not be prepared. Please try a shorter one.');
      setIsPreparing(false);
      return;
    }
    setIsPreparing(false);

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
    onSave(result.boundedText, header.trim(), canvasSetting);
  }

  return (
    <div className="relative flex flex-col gap-8 items-start justify-center w-full h-fit">
      <div className="w-full flex items-center whitespace-nowrap">
        <button type="button" className="no-format shrink-0" onClick={handleSave} disabled={isPreparing}>
          {isPreparing ? '<preparing…>' : '<generate new>'}
        </button>
        <span
          className="text-neutral-500 min-w-0 grow overflow-hidden whitespace-nowrap"
          style={{ textOverflow: 'clip' }}
          aria-hidden="true"
        >
          {generateStarPattern(200, 0x71f3)}
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

      <div className="w-full flex flex-col gap-2">
        <div className="w-full flex flex-row">
          <h3>edit text</h3>
          <h3 className="text-neutral-500 border-b border-dashed flex-grow ml-2 mb-2" />
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
          className="w-full min-h-32 max-h-[36svh] outline-none resize-y overflow-y-auto"
        />
        {note ? (
          <div role="status" className="text-[12px] leading-snug mb-3" style={{ color: 'rgba(255,120,120,0.78)' }}>
            {note}
          </div>
        ) : (
          <div className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {countLabel(text, canvasSetting)} · max {canvasSetting.maxWords} words
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 mb-4">
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
      </div>

      <div className="w-full flex flex-col gap-2">
        <div className="w-full flex flex-row">
          <h3>canvas settings</h3>
          <h3 className="text-neutral-500 border-b border-dashed flex-grow ml-2 mb-2" />
        </div>
        <div className="w-full flex flex-row gap-2 mb-3 flex-wrap" role="group" aria-label="Canvas format">
          {CANVAS_OPTIONS.map((option) => {
            const active = option.id === canvasSetting.id;
            return (
              <button
                type="button"
                key={option.id}
                aria-pressed={active}
                className={[
                  active ? 'is-active' : '',
                  'canvas-option relative flex flex-col w-24 h-28 px-1 pb-2 justify-end items-center text-center',
                ].join(' ')}
                onClick={() => {
                  setCanvasSetting(option);
                  setNote('');
                }}
                onMouseEnter={() => setHoveredOption(option)}
                onMouseLeave={() => setHoveredOption(null)}
                onFocus={() => setHoveredOption(option)}
                onBlur={() => setHoveredOption(null)}
              >
                <CanvasOptionPreview option={option} active={active} />
                <span className="relative z-10 leading-tight">{option.name}</span>
                <span className="relative z-10 text-xs text-neutral-400">
                  {option.kind === 'infinite' ? 'pan + zoom' : `${option.W}×${option.H}`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="text-[12px] leading-snug mb-3" style={{ color: 'rgba(255,255,255,0.62)' }}>
          {shownOption.description}
        </div>
      </div>
    </div>
  );
}
