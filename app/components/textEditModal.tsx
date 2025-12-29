'use client';

import { useState, useEffect, useRef } from 'react';
import { littlePrince, lookingGlass } from '../settings/examples';
import { CANVAS_OPTIONS, CanvasOption } from '../settings/canvasOptions';
import { asciiStars } from '../helpers/drawHelpers';

import CanvasOptionPreview from './CanvasOptionPreview';

const SLACK = 0.78;
const MAX_PARAS = 9;
const MIN_WORDS_PER_PARA = 3;

const BASE_WORD_SIZE = 24;

type TextEditModalProps = {
  onSave: (text: string, header: string, canvasOption: CanvasOption) => void;
  onDownload?: () => void;
};

function ellipseSizeFromWords(wc: number, WORD_SIZE: number, W: number) {
  const minS = 18, maxS = 160, mix = 0.45;

  // convert to “24px-word units”
  const k = WORD_SIZE / BASE_WORD_SIZE;
  const W24 = W / k;

  // run the original sizing model in baseline space
  const sLin = wc * (W24 / 230);
  const sArea = Math.sqrt(wc) * Math.sqrt(W24) * 0.5;
  const s24 = Math.max(minS, Math.min(maxS, (1 - mix) * sLin + mix * sArea));

  // scale back to actual pixel space
  const s = s24 * k;

  return { rx: 1.5 * s, ry: 1.0 * s };
}

function rectAreaFromWords(wc: number, WORD_SIZE: number, W: number) {
  const { rx, ry } = ellipseSizeFromWords(wc, WORD_SIZE, W);
  return (2 * rx) * (2 * ry);
}

function estimateCapPerPara(paragraphCount: number, WORD_SIZE: number, CANVAS_W: number, CANVAS_H: number) {
  const budget = SLACK * CANVAS_W * CANVAS_H;
  let lo = 0, hi = 2000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const area = paragraphCount * rectAreaFromWords(mid, WORD_SIZE, CANVAS_W);
    if (area <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function preflightBoundFromRawText(raw: string, WORD_SIZE: number, CANVAS_W: number, CANVAS_H: number) {
  const all = raw
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Enforce max paragraphs
  const removedParas = Math.max(0, all.length - MAX_PARAS);
  const paras = all.slice(0, MAX_PARAS);

  const budget = SLACK * CANVAS_W * CANVAS_H;
  const uniformCap = paras.length ? estimateCapPerPara(paras.length, WORD_SIZE, CANVAS_W, CANVAS_H) : 0;

  const split = paras.map(p => p.split(' ').filter(Boolean));
  const capped = split.map(t => t.slice(0, uniformCap));

  const totalArea = capped.reduce((a, t) => a + rectAreaFromWords(t.length, WORD_SIZE, CANVAS_W), 0);

  if (totalArea <= budget) {
    const trimmed = split.reduce((z, t, i) => z + Math.max(0, t.length - capped[i].length), 0);
    return { boundedText: capped.map(t => t.join(' ')).join('\n\n'), trimmedWords: trimmed, removedParas, ok: true };
  }

  const cur = capped.map(t => t.slice());
  let over = totalArea - budget;
  let guard = 5000;

  while (over > 0 && guard-- > 0) {
    let bestIdx = -1, bestDelta = 0;

    for (let i = 0; i < cur.length; i++) {
      if (cur[i].length <= MIN_WORDS_PER_PARA) continue;
      const d =
        rectAreaFromWords(cur[i].length, WORD_SIZE, CANVAS_W) -
        rectAreaFromWords(cur[i].length - 1, WORD_SIZE, CANVAS_W);

      if (d > bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    cur[bestIdx].pop();
    over -= bestDelta;
  }

  const trimmed = split.reduce((z, t, i) => z + Math.max(0, t.length - cur[i].length), 0);
  return { boundedText: cur.map(t => t.join(' ')).join('\n\n'), trimmedWords: trimmed, removedParas, ok: over <= 0 };
}

function countWordsAndParas(text: string, option: CanvasOption): string {
  const paras = text
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const wordCount = paras.reduce((a, p) => a + p.split(' ').filter(Boolean).length, 0);
  return `${wordCount} word${wordCount === 1 ? '' : 's'} in ${paras.length} / ${option.maxParas} paragraph${paras.length === 1 ? '' : 's'}`;
}

export default function TextEditModal({ onSave, onDownload }: TextEditModalProps) {
  const [text, setText] = useState<string>(littlePrince.text);
  const [header, setHeader] = useState<string>(littlePrince.header);
  const [canvasSetting, setCanvasSetting] = useState<CanvasOption>(CANVAS_OPTIONS[0]);
  const [note, setNote] = useState<string>('');

  const [hoveredOption, setHoveredOption] = useState<CanvasOption | null>(null);
  const shownOption = hoveredOption ?? canvasSetting;

  const starContainerRef = useRef<HTMLHeadingElement | null>(null);

  function handleExampleClick(example: { text: string; header: string }) {
    setText(example.text);
    setHeader(example.header);
    setNote('');
  }

  function handleSave() {
    const { boundedText, trimmedWords, removedParas, ok } = preflightBoundFromRawText(
      text,
      canvasSetting.WORD_SIZE,
      canvasSetting.W,
      canvasSetting.H
    );

    const parts: string[] = [];
    if (removedParas > 0) parts.push(`Removed ${removedParas} extra paragraph${removedParas === 1 ? '' : 's'} (max ${MAX_PARAS}).`);
    if (trimmedWords > 0) parts.push(`Trimmed ${trimmedWords} word${trimmedWords === 1 ? '' : 's'} to fit ${canvasSetting.W}×${canvasSetting.H}.`);
    if (!ok) parts.push('Reached minimum paragraph size.');

    setNote(parts.join(' '));

    onSave(boundedText, header, canvasSetting);
  }

  function handleDownload() {
    if (onDownload) onDownload();
  }

  function generateStarPattern(length: number): string {
    let pattern = '';
    const asciiStarsWithMore = asciiStars.concat(['-', '·', ' ', '_', '-', '·', ' ', '_']);
    for (let i = 0; i < length; i++) {
      const star = asciiStarsWithMore[Math.floor(Math.random() * asciiStarsWithMore.length)];
      pattern += star;
    }
    return pattern;
  }

  //generate random stars whenever ref changes width
  useEffect(() => {
    const el = starContainerRef.current;
    if (!el) return;

    // make a hidden probe that matches the star span's font styles
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    probe.style.pointerEvents = "none";

    // inherit font from the container
    const cs = getComputedStyle(el);
    probe.style.font = cs.font;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.style.textTransform = cs.textTransform;

    // measure an average character width
    probe.textContent = "................................................"; // 48 chars
    document.body.appendChild(probe);

    const getCharW = () => probe.getBoundingClientRect().width / 48;

    const updateStars = () => {
      const width = el.clientWidth;
      const charW = Math.max(1, getCharW());
      const charCount = Math.ceil(width / charW) + 2;
      el.textContent = generateStarPattern(charCount);
    };

    updateStars();
    const ro = new ResizeObserver(updateStars);
    ro.observe(el);

    window.addEventListener("resize", updateStars);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateStars);
      probe.remove();
    };
  }, []);

  return (
    <div
      className="relative flex flex-col gap-8 items-start justify-center w-full h-fit"
    >
    <div className="w-full flex items-center whitespace-nowrap">
      <button className="no-format shrink-0" onClick={handleSave}>
        {"<generate new>"}
      </button>
      <span
        ref={starContainerRef}
        className="text-neutral-500 grow overflow-hidden whitespace-nowrap"
        style={{ textOverflow: "clip" }}
        suppressHydrationWarning={true}
      >
        {generateStarPattern(200)}
      </span>
      <button className="no-format shrink-0" onClick={handleDownload}>
        {"<download image>"}
      </button>
    </div>

      <div className='w-full flex flex-col gap-2'>
        <div className='w-full flex flex-row'>
          <h3>edit text</h3>
          <h3 className='text-neutral-500 border-b border-dashed flex-grow ml-2 mb-2'/>
        </div>
        <input
          type="text"
          placeholder="Header"
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          className="w-full bg-transparent outline-none"
        />

        <textarea
          value={text}
          onChange={(e) => {setText(e.target.value); setNote('');}}
          placeholder="Paste or type your text…"
          className="w-full h-48 outline-none resize-vertical"
        />
        {note ? (
          <div className="text-[12px] leading-snug mb-3" style={{ color: 'rgba(255,0,0,0.62)' }}>
            {note}
          </div>
        ) : (
          <div className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.62)' }}>
            {countWordsAndParas(text, canvasSetting)}
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 mb-4">
          <button className='no-format' onClick={() => { setText(''); setHeader(''); setNote(''); }}>
            {'<clear>'}
          </button>
          <div className="flex flex-row flex-wrap gap-2">
          <button className='no-format text-neutral-500 text-start' onClick={() => handleExampleClick(lookingGlass)}>
            {'[Through the Looking-Glass]'}
          </button>
          <button className='no-format text-neutral-500 text-start' onClick={() => handleExampleClick(littlePrince)}>
            {'[The Little Prince]'}
          </button>
          </div>
        </div>
      </div>

      <div className='w-full flex flex-col gap-2'>
        <div className='w-full flex flex-row'>
          <h3>canvas settings</h3>
          <h3 className='text-neutral-500 border-b border-dashed flex-grow ml-2 mb-2'/>
        </div>

        <div className="w-full flex flex-row gap-2 mb-3 flex-wrap">
        {CANVAS_OPTIONS.map((option) => {
          const active = option === canvasSetting;
          return (
            <div
              key={option.name}
              className={[
                active ? 'is-active' : '',
                'relative flex flex-col w-24 h-24 justify-center items-center text-center cursor-pointer',
              ].join(' ')}
              onClick={() => setCanvasSetting(option)}
              onMouseEnter={() => setHoveredOption(option)}
              onMouseLeave={() => setHoveredOption(null)}
              onFocus={() => setHoveredOption(option)}
              onBlur={() => setHoveredOption(null)}
            >
              <CanvasOptionPreview option={option} active={active} />
              {option.name} <br />
              <span className="text-xs">{option.W}×{option.H}</span>
            </div>
          );
        })}
        </div>

        {/* description */}
        <div className="text-[12px] leading-snug mb-3" style={{ color: 'rgba(255,255,255,0.62)' }}>
          {shownOption.description}
        </div>
      </div>
    </div>
  );
}
